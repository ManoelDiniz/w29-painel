import { Transform } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'

import { paraNumero } from '../comum/dinheiro'
import { REGIMES, STATUS_OBRA, UNIDADES, type Regime, type StatusObra, type Unidade } from '../entidades'

/** Texto que, vazio, vira null — e não string vazia guardada no banco. */
const textoOuNulo = ({ value }: { value: unknown }) => {
  const v = String(value ?? '').trim()
  return v === '' ? null : v
}

/** '1.234,56' -> 1234.56; vazio -> null; lixo -> NaN (para o @Min reprovar). */
const dinheiroOuNulo = ({ value }: { value: unknown }) => {
  if (value === null || value === undefined || String(value).trim() === '') return null
  if (typeof value === 'number') return value
  const n = paraNumero(String(value))
  return n === null ? Number.NaN : n
}

const dinheiroObrigatorio = ({ value }: { value: unknown }) => {
  if (typeof value === 'number') return value
  const n = paraNumero(String(value ?? ''))
  return n === null ? Number.NaN : n
}

// ------------------------------------------------------------------ obra

export class SalvarObraDto {
  @Transform(({ value }) => String(value ?? '').trim())
  @MinLength(1, { message: 'A obra precisa de um nome.' })
  @MaxLength(160, { message: 'O nome da obra ficou longo demais.' })
  nome!: string

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(160)
  cliente?: string | null

  // Só os 8 dígitos. A máscara é da tela; o banco guarda cru — senão
  // "01310-100" e "01310100" viram dois CEPs diferentes no relatório.
  @IsOptional()
  @Transform(({ value }) => {
    const so = String(value ?? '').replace(/\D/g, '')
    return so === '' ? null : so
  })
  @Matches(/^\d{8}$/, { message: 'CEP inválido. Use 8 números.' })
  cep?: string | null

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(200)
  logradouro?: string | null

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(20)
  numero?: string | null

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(120)
  complemento?: string | null

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(120)
  bairro?: string | null

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(120)
  cidade?: string | null

  @IsOptional()
  @Transform(({ value }) => {
    const v = String(value ?? '').trim().toUpperCase()
    return v === '' ? null : v
  })
  @Matches(/^[A-Z]{2}$/, { message: 'UF inválida. Use duas letras, como SP.' })
  uf?: string | null

  @IsOptional()
  @Transform(dinheiroOuNulo)
  @Min(0, { message: 'Valor do contrato inválido. Use números, como 50.000,00.' })
  @Max(999_999_999_999, { message: 'Valor do contrato grande demais. Confira o que foi digitado.' })
  valorContrato?: number | null

  @IsOptional()
  @Transform(textoOuNulo)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Prazo inválido.' })
  prazo?: string | null

  @IsOptional()
  @IsIn(STATUS_OBRA, { message: 'Status de obra inválido.' })
  status?: StatusObra

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(4000)
  observacao?: string | null
}

// --------------------------------------------------------------- serviço

export class SalvarServicoDto {
  @Transform(({ value }) => String(value ?? '').trim())
  @MinLength(1, { message: 'O serviço precisa de um nome.' })
  @MaxLength(160, { message: 'O nome do serviço ficou longo demais.' })
  nome!: string

  @IsIn(UNIDADES, { message: 'Escolha a unidade (m², metro linear ou unidade).' })
  unidade!: Unidade

  @Transform(dinheiroObrigatorio)
  @Min(0, { message: 'Valor cobrado do cliente inválido.' })
  valorVenda!: number

  @Transform(dinheiroObrigatorio)
  @Min(0, { message: 'Valor pago à equipe inválido.' })
  valorMaoObra!: number

  @IsOptional() @IsBoolean()
  ativo?: boolean
}

// ----------------------------------------------------------- funcionário

export class SalvarFuncionarioDto {
  @Transform(({ value }) => String(value ?? '').trim())
  @MinLength(1, { message: 'O funcionário precisa de um nome.' })
  @MaxLength(160, { message: 'O nome ficou longo demais.' })
  nome!: string

  @IsIn(REGIMES, { message: 'Escolha se ele ganha por produção ou por diária.' })
  regime!: Regime

  @IsOptional()
  @Transform(dinheiroOuNulo)
  @Min(0.01, { message: 'Diarista precisa do valor da diária. Use números, como 120,00.' })
  valorDiaria?: number | null

  @IsOptional()
  @Transform(dinheiroOuNulo)
  @Min(0, { message: 'Valor por produção inválido. Use números, como 4,00.' })
  valorProducao?: number | null

  @IsOptional() @IsBoolean()
  ativo?: boolean
}

// ---------------------------------------------------------------- equipe

export class SalvarEquipeDto {
  @Transform(({ value }) => String(value ?? '').trim())
  @MinLength(1, { message: 'A equipe precisa de um nome.' })
  @MaxLength(160, { message: 'O nome da equipe ficou longo demais.' })
  nome!: string

  @IsArray({ message: 'Escolha pelo menos um membro para a equipe.' })
  @ArrayMinSize(1, { message: 'Escolha pelo menos um membro para a equipe.' })
  @IsUUID('all', { each: true, message: 'Um dos membros escolhidos é inválido.' })
  membros!: string[]

  @IsOptional() @IsBoolean()
  ativo?: boolean
}

// --------------------------------------------------------------- usuário

export class DefinirAtivoDto {
  @IsBoolean({ message: 'Informe se o acesso fica ligado ou desligado.' })
  ativo!: boolean
}
