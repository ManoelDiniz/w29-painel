-- =====================================================================
-- W29 — Controle de produção, gastos e comissões
-- Migration 0001 — schema inicial
-- =====================================================================
-- Regras de negócio que este schema garante no BANCO (não só na tela):
--
--  1. Todo serviço tem DOIS preços: valor_venda (o que o cliente paga)
--     e valor_mao_obra (o que o funcionário recebe). Ex: 15,00 e 4,00.
--     A margem (11,00/m²) é derivada, nunca digitada.
--
--  2. Ao lançar produção, os preços são CONGELADOS na linha do lançamento.
--     Reajustar o preço de um serviço não reescreve o histórico.
--
--  3. Funcionário 'producao' ganha por m²; funcionário 'diaria' ganha por
--     dia trabalhado. O custo de um diarista NUNCA sai do rateio de m² —
--     senão o mesmo trabalho seria pago duas vezes.
--
--  4. Equipe divide a mão de obra em partes iguais, e os centavos de
--     sobra vão para o primeiro da lista (nada de dinheiro evaporando).
--
--  5. Operador não tem SELECT nas tabelas com dinheiro. Ele lança através
--     de funções, e o preço é buscado do lado do servidor. Ele nunca
--     recebe o valor de venda no navegador.
-- =====================================================================

-- gen_random_uuid() é nativo do Postgres desde a v13 — sem extensão.

-- ---------------------------------------------------------------- enums
create type papel_usuario      as enum ('admin', 'operador');
create type regime_funcionario as enum ('producao', 'diaria');
create type unidade_servico    as enum ('m2', 'metro_linear', 'unidade');
create type tipo_executor      as enum ('funcionario', 'equipe');

-- --------------------------------------------------------------- perfis
create table perfis (
  id        uuid primary key references auth.users (id) on delete cascade,
  nome      text not null,
  papel     papel_usuario not null default 'operador',
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

-- O papel NUNCA vem do cadastro do usuário: qualquer um poderia se
-- inscrever pedindo 'admin'. O primeiro usuário do sistema vira admin
-- (bootstrap) e daí em diante todo mundo entra como operador.
create function fn_criar_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_papel papel_usuario;
begin
  select case when exists (select 1 from perfis) then 'operador' else 'admin' end
    into v_papel;

  insert into perfis (id, nome, papel)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'nome'), ''), split_part(new.email, '@', 1)),
    v_papel
  );
  return new;
end;
$$;

create trigger trg_criar_perfil
after insert on auth.users
for each row execute function fn_criar_perfil();

-- Definer para não recursar na RLS de perfis.
create function fn_papel()
returns papel_usuario
language sql
stable
security definer
set search_path = public
as $$ select papel from perfis where id = auth.uid() and ativo $$;

create function fn_e_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select coalesce(fn_papel() = 'admin', false) $$;

create function fn_logado()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select fn_papel() is not null $$;

-- --------------------------------------------------------- funcionarios
create table funcionarios (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null,
  regime       regime_funcionario not null,
  valor_diaria numeric(12, 2),
  ativo        boolean not null default true,
  criado_em    timestamptz not null default now(),

  -- Diarista precisa de diária; comissionado não pode ter uma.
  constraint chk_valor_diaria check (
    (regime = 'diaria'   and valor_diaria is not null and valor_diaria > 0) or
    (regime = 'producao' and valor_diaria is null)
  )
);

-- -------------------------------------------------------------- equipes
create table equipes (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

create table equipe_membros (
  equipe_id      uuid not null references equipes (id) on delete cascade,
  funcionario_id uuid not null references funcionarios (id) on delete cascade,
  primary key (equipe_id, funcionario_id)
);

-- ------------------------------------------------------------- serviços
create table servicos (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  unidade        unidade_servico not null,
  valor_venda    numeric(12, 2) not null check (valor_venda >= 0),
  valor_mao_obra numeric(12, 2) not null check (valor_mao_obra >= 0),
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),

  -- Pagar mais do que se cobra é quase sempre um dígito trocado.
  -- Se algum dia for intencional, é só derrubar este check.
  constraint chk_margem check (valor_mao_obra <= valor_venda)
);

-- ----------------------------------------------------------- pagamentos
-- Fechamento: um pagamento quita comissões e diárias até uma data.
create table pagamentos (
  id             uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references funcionarios (id) on delete restrict,
  valor_total    numeric(14, 2) not null check (valor_total > 0),
  referencia_ate date not null,
  observacao     text,
  pago_em        timestamptz not null default now(),
  criado_por     uuid not null references perfis (id)
);

-- ------------------------------------------------------------ produções
create table producoes (
  id                  uuid primary key default gen_random_uuid(),
  data                date not null,
  servico_id          uuid not null references servicos (id) on delete restrict,
  quantidade          numeric(12, 2) not null check (quantidade > 0),

  tipo_executor       tipo_executor not null,
  funcionario_id      uuid references funcionarios (id) on delete restrict,
  equipe_id           uuid references equipes (id) on delete restrict,

  -- Preços congelados no momento do lançamento (ver regra 2 no topo).
  unidade             unidade_servico not null,
  valor_venda_unit    numeric(12, 2) not null,
  valor_mao_obra_unit numeric(12, 2) not null,

  valor_venda_total   numeric(14, 2) generated always as (quantidade * valor_venda_unit) stored,
  pool_mao_obra       numeric(14, 2) generated always as (quantidade * valor_mao_obra_unit) stored,

  obra                text,
  observacao          text,
  criado_por          uuid not null references perfis (id),
  criado_em           timestamptz not null default now(),

  constraint chk_executor check (
    (tipo_executor = 'funcionario' and funcionario_id is not null and equipe_id is null) or
    (tipo_executor = 'equipe'      and equipe_id is not null      and funcionario_id is null)
  )
);

-- Quanto cada funcionário ganhou em cada lançamento. Gerado por trigger,
-- nunca escrito à mão — é a única fonte da verdade da comissão.
create table producao_rateios (
  id             uuid primary key default gen_random_uuid(),
  producao_id    uuid not null references producoes (id) on delete cascade,
  funcionario_id uuid not null references funcionarios (id) on delete restrict,
  valor          numeric(12, 2) not null check (valor >= 0),
  pagamento_id   uuid references pagamentos (id) on delete set null,
  unique (producao_id, funcionario_id)
);

-- -------------------------------------------------------------- diárias
create table diarias (
  id             uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references funcionarios (id) on delete restrict,
  data           date not null,
  valor          numeric(12, 2) not null check (valor > 0), -- congelado
  observacao     text,
  pagamento_id   uuid references pagamentos (id) on delete set null,
  criado_por     uuid not null references perfis (id),
  criado_em      timestamptz not null default now()
);

-- Sem unique (funcionario_id, data): meia diária e hora extra existem.
-- A tela avisa quando já há lançamento no dia, mas não bloqueia.
create index idx_diarias_func_data on diarias (funcionario_id, data);

-- --------------------------------------------------------------- gastos
create table categorias_gasto (
  id    uuid primary key default gen_random_uuid(),
  nome  text not null unique,
  ativo boolean not null default true
);

create table gastos (
  id           uuid primary key default gen_random_uuid(),
  data         date not null,
  categoria_id uuid not null references categorias_gasto (id) on delete restrict,
  descricao    text not null,
  valor        numeric(12, 2) not null check (valor > 0),
  obra         text,
  criado_por   uuid not null references perfis (id),
  criado_em    timestamptz not null default now()
);

create index idx_producoes_data      on producoes (data desc);
create index idx_producoes_criador   on producoes (criado_por, criado_em desc);
create index idx_rateios_funcionario on producao_rateios (funcionario_id) where pagamento_id is null;
create index idx_diarias_pendentes   on diarias (funcionario_id) where pagamento_id is null;
create index idx_gastos_data         on gastos (data desc);

-- =====================================================================
-- Rateio: divide a mão de obra do lançamento entre quem ganha por produção
-- =====================================================================
create function fn_gerar_rateio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_beneficiarios uuid[];
  v_n             int;
  v_cota          numeric(12, 2);
  v_sobra         numeric(12, 2);
  i               int;
begin
  -- Mexer num lançamento já pago reabriria uma conta fechada. Barra.
  if exists (
    select 1 from producao_rateios
    where producao_id = new.id and pagamento_id is not null
  ) then
    raise exception 'Lançamento já teve a comissão paga e não pode mais ser alterado.';
  end if;

  delete from producao_rateios where producao_id = new.id;

  -- Só entra no rateio quem é pago por produção. O diarista trabalhou,
  -- a produção dele conta pro faturamento, mas o custo dele é a diária.
  if new.tipo_executor = 'funcionario' then
    select array_agg(f.id)
      into v_beneficiarios
      from funcionarios f
     where f.id = new.funcionario_id
       and f.regime = 'producao';
  else
    select array_agg(f.id order by f.nome)
      into v_beneficiarios
      from equipe_membros em
      join funcionarios f on f.id = em.funcionario_id
     where em.equipe_id = new.equipe_id
       and f.regime = 'producao';
  end if;

  v_n := coalesce(array_length(v_beneficiarios, 1), 0);

  -- Equipe só de diaristas: nada a ratear, o custo vive em `diarias`.
  if v_n = 0 then
    return new;
  end if;

  v_cota  := trunc(new.pool_mao_obra / v_n, 2);
  v_sobra := new.pool_mao_obra - (v_cota * v_n);

  for i in 1 .. v_n loop
    insert into producao_rateios (producao_id, funcionario_id, valor)
    values (
      new.id,
      v_beneficiarios[i],
      v_cota + case when i = 1 then v_sobra else 0 end
    );
  end loop;

  return new;
end;
$$;

create trigger trg_gerar_rateio
after insert or update of quantidade, tipo_executor, funcionario_id, equipe_id, valor_mao_obra_unit
on producoes
for each row execute function fn_gerar_rateio();

-- =====================================================================
-- RPCs — todo lançamento passa por aqui. Isso centraliza o congelamento
-- de preço e mantém o operador longe das colunas de dinheiro.
-- =====================================================================

create function rpc_servicos_lancamento()
returns table (id uuid, nome text, unidade unidade_servico)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.nome, s.unidade
    from servicos s
   where s.ativo and fn_logado()
   order by s.nome;
$$;

create function rpc_funcionarios_lancamento()
returns table (id uuid, nome text, regime regime_funcionario)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.nome, f.regime
    from funcionarios f
   where f.ativo and fn_logado()
   order by f.nome;
$$;

create function rpc_equipes_lancamento()
returns table (id uuid, nome text, membros text[])
language sql
stable
security definer
set search_path = public
as $$
  select e.id,
         e.nome,
         coalesce(array_agg(f.nome order by f.nome) filter (where f.id is not null), '{}')
    from equipes e
    left join equipe_membros em on em.equipe_id = e.id
    left join funcionarios f    on f.id = em.funcionario_id and f.ativo
   where e.ativo and fn_logado()
   group by e.id, e.nome
   order by e.nome;
$$;

create function rpc_lancar_producao(
  p_data          date,
  p_servico_id    uuid,
  p_quantidade    numeric,
  p_tipo_executor tipo_executor,
  p_funcionario_id uuid default null,
  p_equipe_id      uuid default null,
  p_obra           text default null,
  p_observacao     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_servico servicos%rowtype;
  v_id      uuid;
begin
  if not fn_logado() then
    raise exception 'Sem permissão para lançar produção.';
  end if;

  select * into v_servico from servicos where id = p_servico_id and ativo;
  if not found then
    raise exception 'Serviço não encontrado ou inativo.';
  end if;

  if p_data > current_date then
    raise exception 'Não dá para lançar produção com data futura.';
  end if;

  insert into producoes (
    data, servico_id, quantidade, tipo_executor, funcionario_id, equipe_id,
    unidade, valor_venda_unit, valor_mao_obra_unit, obra, observacao, criado_por
  )
  values (
    p_data, p_servico_id, p_quantidade, p_tipo_executor, p_funcionario_id, p_equipe_id,
    v_servico.unidade, v_servico.valor_venda, v_servico.valor_mao_obra,
    nullif(trim(p_obra), ''), nullif(trim(p_observacao), ''), auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- O operador diz "fulano trabalhou hoje" e o valor vem do cadastro.
-- Ele nunca digita — nem vê — quanto o colega ganha por dia.
create function rpc_lancar_diaria(
  p_funcionario_id uuid,
  p_data           date,
  p_observacao     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_func funcionarios%rowtype;
  v_id   uuid;
begin
  if not fn_logado() then
    raise exception 'Sem permissão para lançar diária.';
  end if;

  select * into v_func from funcionarios where id = p_funcionario_id and ativo;
  if not found then
    raise exception 'Funcionário não encontrado ou inativo.';
  end if;

  if v_func.regime <> 'diaria' then
    raise exception '% é pago por produção, não por diária.', v_func.nome;
  end if;

  if p_data > current_date then
    raise exception 'Não dá para lançar diária com data futura.';
  end if;

  insert into diarias (funcionario_id, data, valor, observacao, criado_por)
  values (p_funcionario_id, p_data, v_func.valor_diaria, nullif(trim(p_observacao), ''), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- Quantas diárias esse funcionário já tem nesta data — a tela usa isso
-- para avisar sobre duplicata sem bloquear meia diária / hora extra.
create function rpc_diarias_no_dia(p_funcionario_id uuid, p_data date)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from diarias
   where fn_logado()
     and funcionario_id = p_funcionario_id
     and data = p_data;
$$;

-- Apagar um lançamento errado.
--
-- Por que isto é uma função e não uma policy de DELETE: no Postgres, um
-- `delete ... where id = $1` precisa LER a coluna id, então as policies de
-- SELECT também valem. Como o operador não tem SELECT em `producoes` (as
-- linhas carregam preço de venda), o delete dele enxergaria zero linhas e
-- não apagaria nada — calado, sem erro, parecendo que deu certo na tela.
-- Aqui o definer enxerga a linha, checa a dona, e ERRA ALTO quando não pode.
create function rpc_apagar_lancamento(p_tipo text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_criado_por uuid;
  v_criado_em  timestamptz;
begin
  if not fn_logado() then
    raise exception 'Sem permissão.';
  end if;

  case p_tipo
    when 'producao' then
      select criado_por, criado_em into v_criado_por, v_criado_em from producoes where id = p_id;
    when 'diaria' then
      select criado_por, criado_em into v_criado_por, v_criado_em from diarias where id = p_id;
    when 'gasto' then
      select criado_por, criado_em into v_criado_por, v_criado_em from gastos where id = p_id;
    else
      raise exception 'Tipo de lançamento desconhecido: %', p_tipo;
  end case;

  if v_criado_por is null then
    raise exception 'Lançamento não encontrado.';
  end if;

  -- O operador conserta o próprio erro do dia. Fora disso, é com o admin.
  if not fn_e_admin() then
    if v_criado_por <> auth.uid() then
      raise exception 'Esse lançamento foi feito por outra pessoa. Peça ao administrador.';
    end if;
    if v_criado_em <= now() - interval '24 hours' then
      raise exception 'Lançamento com mais de 24h só o administrador pode apagar.';
    end if;
  end if;

  if p_tipo = 'producao' then
    if exists (select 1 from producao_rateios where producao_id = p_id and pagamento_id is not null) then
      raise exception 'A comissão desse lançamento já foi paga — não dá para apagar.';
    end if;
    delete from producoes where id = p_id; -- o rateio vai junto (cascade)

  elsif p_tipo = 'diaria' then
    if exists (select 1 from diarias where id = p_id and pagamento_id is not null) then
      raise exception 'Essa diária já foi paga — não dá para apagar.';
    end if;
    delete from diarias where id = p_id;

  else
    delete from gastos where id = p_id;
  end if;
end;
$$;

-- O que EU lancei. Sem valor de venda, sem comissão: só o suficiente
-- para o operador conferir e apagar um erro do dia.
create function rpc_meus_lancamentos(p_dias int default 7)
returns table (
  id        uuid,
  tipo      text,
  data      date,
  titulo    text,
  subtitulo text,
  valor     numeric,
  criado_em timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select *
    from (
      select p.id,
             'producao'::text,
             p.data,
             s.nome || ' — ' || trim(to_char(p.quantidade, 'FM999999990.00')) || ' ' ||
               case p.unidade
                 when 'm2'           then 'm²'
                 when 'metro_linear' then 'm'
                 else                     'un'
               end,
             coalesce(f.nome, e.nome),
             null::numeric,
             p.criado_em
        from producoes p
        join servicos s          on s.id = p.servico_id
        left join funcionarios f on f.id = p.funcionario_id
        left join equipes e      on e.id = p.equipe_id
       where p.criado_por = auth.uid()
         and p.data >= current_date - p_dias

      union all

      select d.id, 'diaria', d.data, 'Diária', f.nome, null::numeric, d.criado_em
        from diarias d
        join funcionarios f on f.id = d.funcionario_id
       where d.criado_por = auth.uid()
         and d.data >= current_date - p_dias

      union all

      select g.id, 'gasto', g.data, g.descricao, c.nome, g.valor, g.criado_em
        from gastos g
        join categorias_gasto c on c.id = g.categoria_id
       where g.criado_por = auth.uid()
         and g.data >= current_date - p_dias
    ) t (id, tipo, data, titulo, subtitulo, valor, criado_em)
   where fn_logado()
   order by t.data desc, t.criado_em desc;
$$;

-- =====================================================================
-- Visões do admin
-- security_invoker: a RLS das tabelas base vale aqui dentro, então
-- estas visões não viram um buraco por onde o operador lê dinheiro.
-- =====================================================================

create view vw_saldo_funcionarios with (security_invoker = on) as
  select f.id,
         f.nome,
         f.regime,
         coalesce(c.total, 0)                        as comissoes_pendentes,
         coalesce(d.total, 0)                        as diarias_pendentes,
         coalesce(c.total, 0) + coalesce(d.total, 0) as total_a_pagar
    from funcionarios f
    left join (
      select funcionario_id, sum(valor) as total
        from producao_rateios
       where pagamento_id is null
       group by funcionario_id
    ) c on c.funcionario_id = f.id
    left join (
      select funcionario_id, sum(valor) as total
        from diarias
       where pagamento_id is null
       group by funcionario_id
    ) d on d.funcionario_id = f.id
   where f.ativo;

-- Receita, custo real de mão de obra e margem — por mês.
-- O custo de mão de obra é a soma das comissões DEVIDAS mais as diárias.
-- Nunca `quantidade * valor_mao_obra`: isso cobraria o diarista duas vezes.
create view vw_resumo_mensal with (security_invoker = on) as
  with meses as (
    select date_trunc('month', data)::date as mes, sum(valor_venda_total) as receita, 0::numeric as comissoes, 0::numeric as diarias, 0::numeric as gastos
      from producoes group by 1
    union all
    select date_trunc('month', p.data)::date, 0, sum(r.valor), 0, 0
      from producao_rateios r join producoes p on p.id = r.producao_id group by 1
    union all
    select date_trunc('month', data)::date, 0, 0, sum(valor), 0
      from diarias group by 1
    union all
    select date_trunc('month', data)::date, 0, 0, 0, sum(valor)
      from gastos group by 1
  )
  select mes,
         sum(receita)   as receita,
         sum(comissoes) as comissoes,
         sum(diarias)   as diarias,
         sum(gastos)    as gastos,
         sum(receita) - sum(comissoes) - sum(diarias) - sum(gastos) as margem
    from meses
   group by mes
   order by mes desc;

-- =====================================================================
-- RLS
-- Admin: tudo. Operador: entra pelas RPCs, não pelas tabelas.
-- =====================================================================
alter table perfis            enable row level security;
alter table funcionarios      enable row level security;
alter table equipes           enable row level security;
alter table equipe_membros    enable row level security;
alter table servicos          enable row level security;
alter table producoes         enable row level security;
alter table producao_rateios  enable row level security;
alter table diarias           enable row level security;
alter table pagamentos        enable row level security;
alter table categorias_gasto  enable row level security;
alter table gastos            enable row level security;

-- perfis: cada um se enxerga; admin enxerga e gerencia todos.
create policy perfis_ler_proprio on perfis
  for select using (id = auth.uid() or fn_e_admin());
create policy perfis_admin_escreve on perfis
  for update using (fn_e_admin()) with check (fn_e_admin());

-- Cadastros: só o admin toca. O operador lê pelas RPCs.
create policy funcionarios_admin on funcionarios
  for all using (fn_e_admin()) with check (fn_e_admin());
create policy equipes_admin on equipes
  for all using (fn_e_admin()) with check (fn_e_admin());
create policy equipe_membros_admin on equipe_membros
  for all using (fn_e_admin()) with check (fn_e_admin());
create policy servicos_admin on servicos
  for all using (fn_e_admin()) with check (fn_e_admin());
create policy pagamentos_admin on pagamentos
  for all using (fn_e_admin()) with check (fn_e_admin());
create policy rateios_admin on producao_rateios
  for all using (fn_e_admin()) with check (fn_e_admin());

-- Categorias de gasto não são sigilosas: o operador precisa escolher uma.
create policy categorias_leitura on categorias_gasto
  for select using (fn_logado());
create policy categorias_admin on categorias_gasto
  for all using (fn_e_admin()) with check (fn_e_admin());

-- Produções e diárias: o operador NÃO lê estas tabelas — as linhas carregam
-- preço de venda e comissão. Ele lança por rpc_lancar_*, confere em
-- rpc_meus_lancamentos e corrige por rpc_apagar_lancamento. Nenhuma policy
-- de DELETE para ele aqui: sem SELECT, um delete direto acharia zero linhas
-- e falharia em silêncio (é o que a RPC existe para evitar).
create policy producoes_admin on producoes
  for all using (fn_e_admin()) with check (fn_e_admin());

create policy diarias_admin on diarias
  for all using (fn_e_admin()) with check (fn_e_admin());

-- Gastos: o valor é o que o próprio operador digitou — não há margem
-- escondida ali. Então ele lê e lança os seus direto na tabela.
create policy gastos_admin on gastos
  for all using (fn_e_admin()) with check (fn_e_admin());
create policy gastos_operador_le_proprio on gastos
  for select using (criado_por = auth.uid());
create policy gastos_operador_lanca on gastos
  for insert with check (fn_logado() and criado_por = auth.uid());

-- ------------------------------------------------------------- semente
insert into categorias_gasto (nome) values
  ('Material'),
  ('Combustível'),
  ('Ferramenta'),
  ('Manutenção'),
  ('Alimentação'),
  ('Transporte'),
  ('Outros');
