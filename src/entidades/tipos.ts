/**
 * Os enums do domínio.
 *
 * No Postgres eles eram `create type ... as enum`. No MySQL viram colunas
 * ENUM, declaradas nas migrations. Aqui ficam só como tipos do TypeScript
 * e listas para validação — uma fonte única para o banco, os DTOs e o front.
 */

export const PAPEIS = ['admin', 'operador'] as const
export type Papel = (typeof PAPEIS)[number]

export const REGIMES = ['producao', 'diaria'] as const
export type Regime = (typeof REGIMES)[number]

export const UNIDADES = ['m2', 'metro_linear', 'unidade'] as const
export type Unidade = (typeof UNIDADES)[number]

export const TIPOS_EXECUTOR = ['funcionario', 'equipe'] as const
export type TipoExecutor = (typeof TIPOS_EXECUTOR)[number]

export const STATUS_OBRA = ['em_andamento', 'concluida', 'cancelada'] as const
export type StatusObra = (typeof STATUS_OBRA)[number]

export const TIPOS_LANCAMENTO = ['producao', 'diaria', 'gasto'] as const
export type TipoLancamento = (typeof TIPOS_LANCAMENTO)[number]
