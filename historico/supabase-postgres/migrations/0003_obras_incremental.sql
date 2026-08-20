-- =====================================================================
-- W29 — Migration 0003: ajustes incrementais para obras e pricing
--
-- Esta migração mantém o comportamento da 0002 sem recriar objetos já
-- existentes e é segura para rodar em bancos que já foram aplicados.
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'status_obra') then
    create type status_obra as enum ('em_andamento', 'concluida', 'cancelada');
  end if;
end $$;

create table if not exists obras (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  cliente        text,
  cep            text,
  logradouro     text,
  numero         text,
  complemento    text,
  bairro         text,
  cidade         text,
  uf             char(2),
  valor_contrato numeric(14, 2) check (valor_contrato is null or valor_contrato >= 0),
  prazo          date,
  status         status_obra not null default 'em_andamento',
  observacao     text,
  criado_por     uuid not null references perfis (id),
  criado_em      timestamptz not null default now(),
  constraint chk_cep check (cep is null or cep ~ '^[0-9]{8}$')
);

alter table obras add column if not exists cliente text;
alter table obras add column if not exists cep text;
alter table obras add column if not exists logradouro text;
alter table obras add column if not exists numero text;
alter table obras add column if not exists complemento text;
alter table obras add column if not exists bairro text;
alter table obras add column if not exists cidade text;
alter table obras add column if not exists uf char(2);
alter table obras add column if not exists valor_contrato numeric(14, 2);
alter table obras add column if not exists prazo date;
alter table obras add column if not exists status status_obra;
alter table obras add column if not exists observacao text;
alter table obras add column if not exists criado_por uuid;
alter table obras add column if not exists criado_em timestamptz;

create index if not exists idx_obras_status on obras (status) where status = 'em_andamento';

alter table funcionarios add column if not exists valor_producao numeric(12, 2);

alter table producoes add column if not exists obra_id uuid references obras (id) on delete restrict;
alter table gastos    add column if not exists obra_id uuid references obras (id) on delete restrict;

do $$
declare
  v_resgate uuid;
  v_admin   uuid;
begin
  if exists (select 1 from producoes where obra_id is null)
     or exists (select 1 from gastos where obra_id is null) then

    select id into v_admin from perfis where papel = 'admin' order by criado_em limit 1;

    insert into obras (nome, observacao, criado_por)
    values (
      'Obra não informada',
      'Criada pela migração 0003 para abrigar lançamentos antigos, de quando a obra era um texto opcional. Reclassifique-os e depois conclua esta obra.',
      v_admin
    )
    returning id into v_resgate;

    update producoes set obra_id = v_resgate where obra_id is null;
    update gastos    set obra_id = v_resgate where obra_id is null;
  end if;
end $$;

alter table producoes alter column obra_id set not null;
alter table gastos    alter column obra_id set not null;

alter table producoes drop column if exists obra;
alter table gastos    drop column if exists obra;

alter table obras enable row level security;

create or replace function fn_gerar_rateio()
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
  if exists (
    select 1 from producao_rateios
    where producao_id = new.id and pagamento_id is not null
  ) then
    raise exception 'Lançamento já teve a comissão paga e não pode mais ser alterado.';
  end if;

  delete from producao_rateios where producao_id = new.id;

  if new.tipo_executor = 'funcionario' then
    if exists (
      select 1
        from funcionarios f
       where f.id = new.funcionario_id
         and f.regime = 'producao'
         and f.valor_producao is not null
    ) then
      return new;
    end if;

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

drop function if exists rpc_obras_lancamento();
create or replace function rpc_obras_lancamento()
returns table (id uuid, nome text, cliente text, bairro text, cidade text)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.nome, o.cliente, o.bairro, o.cidade
    from obras o
   where o.status = 'em_andamento'
     and fn_logado()
   order by o.nome;
$$;

create or replace function rpc_lancar_producao(
  p_data           date,
  p_servico_id     uuid,
  p_quantidade     numeric,
  p_tipo_executor  tipo_executor,
  p_obra_id        uuid,
  p_funcionario_id uuid default null,
  p_equipe_id      uuid default null,
  p_observacao     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_servico servicos%rowtype;
  v_obra    obras%rowtype;
  v_funcionario funcionarios%rowtype;
  v_valor_mao_obra numeric(12, 2);
  v_id      uuid;
begin
  if not fn_logado() then
    raise exception 'Sem permissão para lançar produção.';
  end if;

  select * into v_servico from servicos where id = p_servico_id and ativo;
  if not found then
    raise exception 'Serviço não encontrado ou inativo.';
  end if;

  select * into v_obra from obras where id = p_obra_id;
  if not found then
    raise exception 'Obra não encontrada.';
  end if;
  if v_obra.status <> 'em_andamento' then
    raise exception 'A obra "%" está %. Não dá para lançar nela.',
      v_obra.nome,
      case v_obra.status when 'concluida' then 'concluída' else 'cancelada' end;
  end if;

  if p_data > current_date then
    raise exception 'Não dá para lançar produção com data futura.';
  end if;

  if p_tipo_executor = 'funcionario' and p_funcionario_id is not null then
    select * into v_funcionario from funcionarios where id = p_funcionario_id and ativo;
    if not found then
      raise exception 'Funcionário não encontrado ou inativo.';
    end if;

    if v_funcionario.regime = 'producao' and v_funcionario.valor_producao is not null then
      v_valor_mao_obra := v_funcionario.valor_producao;
    else
      v_valor_mao_obra := v_servico.valor_mao_obra;
    end if;
  else
    v_valor_mao_obra := v_servico.valor_mao_obra;
  end if;

  insert into producoes (
    data, servico_id, quantidade, tipo_executor, funcionario_id, equipe_id,
    unidade, valor_venda_unit, valor_mao_obra_unit, obra_id, observacao, criado_por
  )
  values (
    p_data, p_servico_id, p_quantidade, p_tipo_executor, p_funcionario_id, p_equipe_id,
    v_servico.unidade, v_servico.valor_venda, v_valor_mao_obra,
    p_obra_id, nullif(trim(p_observacao), ''), auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function rpc_lancar_gasto(
  p_data         date,
  p_categoria_id uuid,
  p_descricao    text,
  p_valor        numeric,
  p_obra_id      uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_obra obras%rowtype;
  v_id   uuid;
begin
  if not fn_logado() then
    raise exception 'Sem permissão para lançar gasto.';
  end if;

  if coalesce(trim(p_descricao), '') = '' then
    raise exception 'Diga o que foi comprado.';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'O valor do gasto precisa ser maior que zero.';
  end if;

  if not exists (select 1 from categorias_gasto where id = p_categoria_id and ativo) then
    raise exception 'Categoria de gasto não encontrada.';
  end if;

  select * into v_obra from obras where id = p_obra_id;
  if not found then
    raise exception 'Obra não encontrada.';
  end if;
  if v_obra.status <> 'em_andamento' then
    raise exception 'A obra "%" está %. Não dá para lançar nela.',
      v_obra.nome,
      case v_obra.status when 'concluida' then 'concluída' else 'cancelada' end;
  end if;

  if p_data > current_date then
    raise exception 'Não dá para lançar gasto com data futura.';
  end if;

  insert into gastos (data, categoria_id, descricao, valor, obra_id, criado_por)
  values (p_data, p_categoria_id, trim(p_descricao), p_valor, p_obra_id, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

drop policy if exists gastos_operador_lanca on gastos;

create or replace function rpc_meus_lancamentos(p_dias int default 7)
returns table (
  id        uuid,
  tipo      text,
  data      date,
  titulo    text,
  subtitulo text,
  obra      text,
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
             o.nome,
             null::numeric,
             p.criado_em
        from producoes p
        join servicos s          on s.id = p.servico_id
        join obras o             on o.id = p.obra_id
        left join funcionarios f on f.id = p.funcionario_id
        left join equipes e      on e.id = p.equipe_id
       where p.criado_por = auth.uid()
         and p.data >= current_date - p_dias

      union all

      select d.id, 'diaria', d.data, 'Diária', f.nome, null, null::numeric, d.criado_em
        from diarias d
        join funcionarios f on f.id = d.funcionario_id
       where d.criado_por = auth.uid()
         and d.data >= current_date - p_dias

      union all

      select g.id, 'gasto', g.data, g.descricao, c.nome, o.nome, g.valor, g.criado_em
        from gastos g
        join categorias_gasto c on c.id = g.categoria_id
        join obras o            on o.id = g.obra_id
       where g.criado_por = auth.uid()
         and g.data >= current_date - p_dias
    ) t (id, tipo, data, titulo, subtitulo, obra, valor, criado_em)
   where fn_logado()
   order by t.data desc, t.criado_em desc;
$$;

drop view if exists vw_saldo_funcionarios;
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
   where f.ativo
     and coalesce(c.total, 0) + coalesce(d.total, 0) > 0;

drop view if exists vw_resumo_mensal;
create view vw_resumo_mensal with (security_invoker = on) as
  with meses as (
    select date_trunc('month', data)::date as mes,
           sum(valor_venda_total) as receita,
           0::numeric as comissoes,
           0::numeric as diarias,
           0::numeric as gastos
      from producoes p
     where not (
       p.tipo_executor = 'funcionario'
       and p.funcionario_id is not null
       and exists (
         select 1
           from funcionarios f
          where f.id = p.funcionario_id
            and f.regime = 'producao'
            and f.valor_producao is not null
       )
     )
     group by 1
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

drop view if exists vw_resumo_obras;
create view vw_resumo_obras with (security_invoker = on) as
  select o.id,
         o.nome,
         o.cliente,
         o.status,
         o.valor_contrato,
         o.prazo,
         coalesce(p.receita, 0)   as receita,
         coalesce(p.comissoes, 0) as comissoes,
         coalesce(g.gastos, 0)    as gastos,
         coalesce(p.receita, 0) - coalesce(p.comissoes, 0) - coalesce(g.gastos, 0) as margem
    from obras o
    left join (
      select pr.obra_id,
             sum(pr.valor_venda_total) as receita,
             sum(coalesce(r.total, 0)) as comissoes
        from producoes pr
        left join (
          select producao_id, sum(valor) as total
            from producao_rateios
           group by producao_id
        ) r on r.producao_id = pr.id
       where not (
         pr.tipo_executor = 'funcionario'
         and pr.funcionario_id is not null
         and exists (
           select 1
             from funcionarios f
            where f.id = pr.funcionario_id
              and f.regime = 'producao'
              and f.valor_producao is not null
         )
       )
       group by pr.obra_id
    ) p on p.obra_id = o.id
    left join (
      select obra_id, sum(valor) as gastos
        from gastos
       group by obra_id
    ) g on g.obra_id = o.id;
