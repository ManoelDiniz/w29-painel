// Roda as migrations num Postgres real (PGlite, em WASM) e confere as regras
// de dinheiro. Sem Docker, sem projeto Supabase: `npm run test:schema`.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const db = new PGlite()
const dirMigrations = fileURLToPath(new URL('../migrations/', import.meta.url))
const migrations = readdirSync(dirMigrations).filter((f) => f.endsWith('.sql')).sort()

let pass = 0, fail = 0
const check = (nome, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado)
  ok ? pass++ : fail++
  console.log(`${ok ? 'OK  ' : 'FALHA'} ${nome}${ok ? '' : `\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(real)}`}`)
}
const erro = async (nome, fn, trecho) => {
  try { await fn(); fail++; console.log(`FALHA ${nome}\n        esperava erro, mas passou`) }
  catch (e) {
    const ok = e.message.includes(trecho)
    ok ? pass++ : fail++
    console.log(`${ok ? 'OK  ' : 'FALHA'} ${nome}${ok ? '' : `\n        esperava "${trecho}", veio "${e.message}"`}`)
  }
}

// --- Stub do que o Supabase provê: schema auth, auth.users, auth.uid() ---
await db.exec(`
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid
  $$;
  create role authenticated nologin;
  grant usage on schema public to authenticated;
`)

console.log('\n=== 1. As migrations rodam, em ordem? ===')
for (const arquivo of migrations) {
  try {
    await db.exec(readFileSync(dirMigrations + arquivo, 'utf8'))
    console.log(`OK   ${arquivo}`)
    pass++
  } catch (e) {
    console.log(`FALHA ${arquivo}: ${e.message}${e.hint ? `\n        dica: ${e.hint}` : ''}`)
    process.exit(1)
  }
}

await db.exec(`
  grant all on all tables in schema public to authenticated;
  grant execute on all functions in schema public to authenticated;
`)

const como = (uid) => db.query(`select set_config('test.uid', $1, false)`, [uid])
const one = async (q, p = []) => (await db.query(q, p)).rows[0]
const all = async (q, p = []) => (await db.query(q, p)).rows

console.log('\n=== 2. Bootstrap: primeiro usuário vira admin, o resto operador ===')
const admin = await one(`insert into auth.users (email) values ('chefe@w29.com') returning id`)
const oper  = await one(`insert into auth.users (email) values ('operador@w29.com') returning id`)
check('1º usuário = admin',    (await one(`select papel from perfis where id=$1`, [admin.id])).papel, 'admin')
check('2º usuário = operador', (await one(`select papel from perfis where id=$1`, [oper.id])).papel, 'operador')

await como(admin.id)

console.log('\n=== 3. Cadastros ===')
const svc = await one(`insert into servicos (nome, unidade, valor_venda, valor_mao_obra)
                       values ('Piso porcelanato','m2',15,4) returning id`)
const ana    = await one(`insert into funcionarios (nome, regime) values ('Ana','producao') returning id`)
const bruno  = await one(`insert into funcionarios (nome, regime) values ('Bruno','producao') returning id`)
const dora   = await one(`insert into funcionarios (nome, regime, valor_producao) values ('Dora','producao',3.50) returning id`)
const carlos = await one(`insert into funcionarios (nome, regime, valor_diaria) values ('Carlos','diaria',120) returning id`)

await erro('diarista sem valor de diária é barrado',
  () => db.exec(`insert into funcionarios (nome, regime) values ('Zé','diaria')`), 'chk_valor_diaria')
await erro('comissionado com diária é barrado',
  () => db.exec(`insert into funcionarios (nome, regime, valor_diaria) values ('Zé','producao',100)`), 'chk_valor_diaria')
await erro('pagar mais do que cobra é barrado',
  () => db.exec(`insert into servicos (nome,unidade,valor_venda,valor_mao_obra) values ('X','m2',4,15)`), 'chk_margem')

const eq = await one(`insert into equipes (nome) values ('Equipe A') returning id`)
await db.query(`insert into equipe_membros (equipe_id, funcionario_id) values ($1,$2),($1,$3),($1,$4)`,
  [eq.id, ana.id, bruno.id, carlos.id])

console.log('\n=== 4. Obra ===')
const obra = await one(
  `insert into obras (nome, cliente, cep, logradouro, numero, bairro, cidade, uf, valor_contrato, criado_por)
   values ('Casa do Centro','Dona Maria','60000000','Rua das Flores','120','Centro','Fortaleza','CE',50000,$1)
   returning id`, [admin.id])
await erro('CEP com formato errado é barrado',
  () => db.query(`insert into obras (nome, cep, criado_por) values ('X','6000-000',$1)`, [admin.id]), 'chk_cep')
check('obra nasce em andamento',
  (await one(`select status from obras where id=$1`, [obra.id])).status, 'em_andamento')

console.log('\n=== 5. O cálculo: 100 m² x R$15 vendidos, R$4 de mão de obra ===')
const prod = await one(
  `select rpc_lancar_producao(current_date, $1, 100, 'equipe', $2, null, $3) as id`, [svc.id, obra.id, eq.id])

const p = await one(`select valor_venda_unit, valor_mao_obra_unit, valor_venda_total, pool_mao_obra
                     from producoes where id=$1`, [prod.id])
check('receita = 100 x 15', p.valor_venda_total, '1500.00')
check('mão de obra = 100 x 4', p.pool_mao_obra, '400.00')

const prodOverride = await one(
  `select rpc_lancar_producao(current_date, $1, 100, 'funcionario', $2, $3) as id`, [svc.id, obra.id, dora.id])
const po = await one(`select pool_mao_obra from producoes where id=$1`, [prodOverride.id])
check('valor próprio do funcionário sobrescreve o do serviço', po.pool_mao_obra, '350.00')

const rat = await all(`select f.nome, r.valor from producao_rateios r
                       join funcionarios f on f.id=r.funcionario_id
                       where r.producao_id=$1 order by f.nome`, [prod.id])
check('equipe de 3 (2 produção + 1 diarista): só os 2 rateiam, R$200 cada',
  rat, [{ nome: 'Ana', valor: '200.00' }, { nome: 'Bruno', valor: '200.00' }])

await db.query(`select rpc_lancar_diaria($1, current_date)`, [carlos.id])
check('diarista recebe a diária cadastrada, não m²',
  (await one(`select valor from diarias where funcionario_id=$1`, [carlos.id])).valor, '120.00')

await erro('lançar diária para quem é pago por produção falha',
  () => db.query(`select rpc_lancar_diaria($1, current_date)`, [ana.id]), 'pago por produção')

console.log('\n=== 6. Obra obrigatória, e obra fechada não recebe lançamento ===')
await erro('produção sem obra é recusada',
  () => db.query(`select rpc_lancar_producao(current_date, $1, 10, 'funcionario', null, $2)`, [svc.id, ana.id]),
  'Obra não encontrada')

const obraFechada = await one(
  `insert into obras (nome, status, criado_por) values ('Obra Antiga','concluida',$1) returning id`, [admin.id])
await erro('produção em obra concluída é recusada, dizendo o nome dela',
  () => db.query(`select rpc_lancar_producao(current_date, $1, 10, 'funcionario', $2, $3)`,
    [svc.id, obraFechada.id, ana.id]), 'está concluída')
await erro('gasto em obra concluída também é recusado',
  () => db.query(`select rpc_lancar_gasto(current_date, (select id from categorias_gasto where nome='Material'),
                  'Cimento', 300, $1)`, [obraFechada.id]), 'está concluída')
check('obra concluída nem aparece na lista de lançamento',
  (await all(`select nome from rpc_obras_lancamento()`)).map(o => o.nome), ['Casa do Centro'])

console.log('\n=== 7. Centavos não podem evaporar ===')
const svc2 = await one(`insert into servicos (nome,unidade,valor_venda,valor_mao_obra)
                        values ('Rejunte','metro_linear',5,1) returning id`)
const dani = await one(`insert into funcionarios (nome, regime) values ('Dani','producao') returning id`)
const eq2 = await one(`insert into equipes (nome) values ('Equipe B') returning id`)
await db.query(`insert into equipe_membros (equipe_id, funcionario_id) values ($1,$2),($1,$3),($1,$4)`,
  [eq2.id, ana.id, bruno.id, dani.id])
const prod2 = await one(
  `select rpc_lancar_producao(current_date, $1, 100, 'equipe', $2, null, $3) as id`, [svc2.id, obra.id, eq2.id])
const rat2 = await all(`select f.nome, r.valor from producao_rateios r
                        join funcionarios f on f.id=r.funcionario_id
                        where r.producao_id=$1 order by f.nome`, [prod2.id])
check('R$100 / 3 = 33.34 + 33.33 + 33.33 (a sobra vai pro primeiro)',
  rat2, [{ nome: 'Ana', valor: '33.34' }, { nome: 'Bruno', valor: '33.33' }, { nome: 'Dani', valor: '33.33' }])
check('soma do rateio = pool exato, sem centavo perdido',
  (await one(`select sum(valor) s from producao_rateios where producao_id=$1`, [prod2.id])).s, '100.00')

console.log('\n=== 8. Reajustar preço não reescreve o passado ===')
await db.query(`update servicos set valor_venda=18, valor_mao_obra=5 where id=$1`, [svc.id])
check('lançamento antigo continua 15/4 e R$1500',
  await one(`select valor_venda_unit, valor_mao_obra_unit, valor_venda_total from producoes where id=$1`, [prod.id]),
  { valor_venda_unit: '15.00', valor_mao_obra_unit: '4.00', valor_venda_total: '1500.00' })
const novo = await one(
  `select rpc_lancar_producao(current_date, $1, 10, 'funcionario', $2, $3) as id`, [svc.id, obra.id, ana.id])
check('lançamento novo já usa 18/5',
  await one(`select valor_venda_total, pool_mao_obra from producoes where id=$1`, [novo.id]),
  { valor_venda_total: '180.00', pool_mao_obra: '50.00' })

console.log('\n=== 9. Saldo a pagar, margem e resumo da obra ===')
await db.query(`select rpc_lancar_gasto(current_date, (select id from categorias_gasto where nome='Material'),
                'Saco de cimento', 300, $1)`, [obra.id])

const saldos = await all(`select nome, comissoes_pendentes, total_a_pagar
                          from vw_saldo_funcionarios order by nome`)
// Ana = 200,00 (Equipe A) + 33,34 (Equipe B) + 50,00 (sozinha, já no preço novo)
// Bruno = 200,00 + 33,33 | Carlos = 1 diária de 120,00 | Dani = 33,33
check('saldo a pagar de cada um',
  saldos.map(s => `${s.nome}:${s.total_a_pagar}`),
  ['Ana:283.34', 'Bruno:233.33', 'Carlos:120.00', 'Dani:33.33'])
check('Carlos (diarista) não tem um centavo de comissão de m²',
  saldos.find(s => s.nome === 'Carlos').comissoes_pendentes, '0')

const r = await one(`select receita, comissoes, diarias, gastos, margem from vw_resumo_mensal limit 1`)
check('receita = 1500 + 500 + 180', r.receita, '2180.00')
check('comissões = 400 + 100 + 50', r.comissoes, '550.00')
check('margem = 2180 - 550 comissões - 120 diária - 300 material', r.margem, '1210.00')

const ro = await one(`select receita, comissoes, gastos, margem, valor_contrato
                      from vw_resumo_obras where id=$1`, [obra.id])
check('resumo da obra: tudo que entrou e saiu nela',
  ro, { receita: '2180.00', comissoes: '550.00', gastos: '300.00', margem: '1330.00', valor_contrato: '50000.00' })

console.log('\n=== 10. Conta paga não se reabre ===')
const pgto = await one(`insert into pagamentos (funcionario_id, valor_total, referencia_ate, criado_por)
                        values ($1, 283.34, current_date, $2) returning id`, [ana.id, admin.id])
await db.query(`update producao_rateios set pagamento_id=$1 where funcionario_id=$2`, [pgto.id, ana.id])
await erro('editar produção já paga é bloqueado',
  () => db.query(`update producoes set quantidade=200 where id=$1`, [prod.id]), 'já teve a comissão paga')

console.log('\n=== 11. RLS: o operador enxerga o quê? ===')
await db.exec(`set role authenticated`)
await como(oper.id)
check('operador NÃO lê a tabela de produções (tem preço de venda)',
  (await all(`select * from producoes`)).length, 0)
check('operador NÃO lê serviços (tem margem)',
  (await all(`select * from servicos`)).length, 0)
check('operador NÃO lê funcionários (tem salário)',
  (await all(`select * from funcionarios`)).length, 0)
check('operador NÃO lê o rateio de comissões',
  (await all(`select * from producao_rateios`)).length, 0)
check('operador NÃO lê obras direto (tem valor de contrato)',
  (await all(`select * from obras`)).length, 0)
check('operador NÃO lê o saldo a pagar',
  (await all(`select * from vw_saldo_funcionarios`)).length, 0)
check('operador NÃO lê o resumo das obras',
  (await all(`select * from vw_resumo_obras`)).length, 0)

check('...mas escolhe a obra pela RPC — sem o valor do contrato',
  Object.keys((await all(`select * from rpc_obras_lancamento()`))[0] ?? {}),
  ['id', 'nome', 'cliente', 'bairro', 'cidade'])
check('...e escolhe o serviço pela RPC — sem preço',
  Object.keys((await all(`select * from rpc_servicos_lancamento()`))[0] ?? {}),
  ['id', 'nome', 'unidade'])

const pOper = await one(
  `select rpc_lancar_producao(current_date, $1, 50, 'funcionario', $2, $3) as id`, [svc.id, obra.id, bruno.id])
check('operador CONSEGUE lançar produção pela RPC', typeof pOper.id, 'string')

await db.query(`select rpc_lancar_gasto(current_date,
  (select id from categorias_gasto where nome='Combustível'), 'Gasolina', 200, $1)`, [obra.id])

check('operador vê o que ELE lançou, com a obra e sem comissão nenhuma',
  await all(`select tipo, titulo, obra, valor from rpc_meus_lancamentos()`),
  [
    { tipo: 'gasto', titulo: 'Gasolina', obra: 'Casa do Centro', valor: '200.00' },
    { tipo: 'producao', titulo: 'Piso porcelanato — 50.00 m²', obra: 'Casa do Centro', valor: null },
  ])

await erro('operador não consegue cadastrar obra',
  () => db.query(`insert into obras (nome, criado_por) values ('Obra Pirata', $1)`, [oper.id]),
  'row-level security')
await erro('operador não consegue cadastrar serviço',
  () => db.exec(`insert into servicos (nome,unidade,valor_venda,valor_mao_obra) values ('Hack','m2',1,1)`),
  'row-level security')
await erro('operador não escreve mais direto na tabela de gastos',
  () => db.query(`insert into gastos (data, categoria_id, descricao, valor, obra_id, criado_por)
                  select current_date, id, 'Pulando a função', 1, $1, $2 from categorias_gasto limit 1`,
    [obra.id, oper.id]), 'row-level security')

// A RLS não estoura erro aqui: ela esconde a linha, e o UPDATE pega 0 linhas.
const tentativa = await db.query(`update perfis set papel='admin' where id=$1`, [oper.id])
check('operador tentando se promover a admin não altera nada', tentativa.affectedRows, 0)

console.log('\n=== 12. Operador conserta o próprio erro, e só o próprio ===')
await erro('apagar lançamento de outra pessoa é RECUSADO em voz alta',
  () => db.query(`select rpc_apagar_lancamento('producao', $1)`, [prod.id]), 'outra pessoa')
await erro('id que não existe é recusado, não ignorado em silêncio',
  () => db.query(`select rpc_apagar_lancamento('producao', gen_random_uuid())`), 'não encontrado')

await db.query(`select rpc_apagar_lancamento('producao', $1)`, [pOper.id])
check('operador apaga a produção que ele mesmo fez hoje',
  (await all(`select * from rpc_meus_lancamentos() where tipo='producao'`)).length, 0)

await db.exec(`reset role`); await como(admin.id)
check('e o rateio da comissão some junto (cascade), sem comissão órfã',
  (await all(`select 1 from producao_rateios where producao_id=$1`, [pOper.id])).length, 0)
check('o papel do operador continua operador',
  (await one(`select papel from perfis where id=$1`, [oper.id])).papel, 'operador')

await erro('nem o admin apaga produção com comissão já paga',
  () => db.query(`select rpc_apagar_lancamento('producao', $1)`, [prod2.id]), 'já foi paga')

await erro('obra com lançamento não pode ser apagada (levaria o histórico junto)',
  () => db.query(`delete from obras where id=$1`, [obra.id]), 'violates RESTRICT')

await db.exec(`reset role`)
console.log(`\n${'='.repeat(60)}\n${pass} passaram, ${fail} falharam\n`)
process.exit(fail ? 1 : 0)
