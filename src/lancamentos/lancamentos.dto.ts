import { Transform } from 'class-transformer'
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator'

import { dataValida } from '../comum/datas'
import { paraNumero } from '../comum/dinheiro'
import { TIPOS_EXECUTOR, type TipoExecutor } from '../entidades'

@ValidatorConstraint({ name: 'dataISO' })
class DataISO implements ValidatorConstraintInterface {
  validate(valor: unknown): boolean {
    return typeof valor === 'string' && dataValida(valor)
  }
  defaultMessage(): string {
    return 'Data inválida.'
  }
}

/**
 * Número que chega como texto do formulário.
 *
 * O front manda "12,5" — é o que o teclado brasileiro produz e o que o
 * usuário digita. Converter aqui, e não na tela, garante que um cliente
 * qualquer (curl, script de importação) não consiga enfiar `"12,5"` numa
 * coluna DECIMAL e receber 12 de volta, calado.
 */
const paraDecimalOuNaN = ({ value }: { value: unknown }) => {
  if (typeof value === 'number') return value
  const n = paraNumero(String(value ?? ''))
  return n === null ? Number.NaN : n
}

export class LancarProducaoDto {
  @Validate(DataISO)
  data!: string

  @IsUUID('all', { message: 'Escolha o serviço.' })
  servicoId!: string

  @IsUUID('all', { message: 'Escolha a obra.' })
  obraId!: string

  @Transform(paraDecimalOuNaN)
  @Min(0.01, { message: 'Quantidade inválida. Use números, como 12,5.' })
  @Max(9_999_999_999, { message: 'Quantidade grande demais. Confira o que foi digitado.' })
  quantidade!: number

  @IsIn(TIPOS_EXECUTOR, { message: 'Escolha a turma.' })
  tipoExecutor!: TipoExecutor

  /**
   * Um dos dois vem preenchido, conforme o tipoExecutor. Qual dos dois é
   * checado no service, e não aqui: a regra ("funcionário XOR equipe") fala
   * de dois campos ao mesmo tempo, e uma mensagem escrita nesse nível
   * explica melhor o que fazer do que dois erros de campo soltos.
   */
  @IsOptional()
  @IsUUID('all', { message: 'Escolha a turma.' })
  funcionarioId?: string

  @IsOptional()
  @IsUUID('all', { message: 'Escolha a equipe.' })
  equipeId?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'A observação ficou longa demais.' })
  observacao?: string
}

export class LancarDiariaDto {
  @IsUUID('all', { message: 'Escolha o diarista.' })
  funcionarioId!: string

  @Validate(DataISO)
  data!: string

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'A observação ficou longa demais.' })
  observacao?: string
}

export class LancarGastoDto {
  @Validate(DataISO)
  data!: string

  @IsUUID('all', { message: 'Escolha a categoria.' })
  categoriaId!: string

  @IsUUID('all', { message: 'Escolha a obra.' })
  obraId!: string

  @Transform(({ value }) => String(value ?? '').trim())
  @IsString({ message: 'Diga o que foi comprado.' })
  @MinLength(1, { message: 'Diga o que foi comprado.' })
  @MaxLength(300, { message: 'A descrição ficou longa demais.' })
  descricao!: string

  @Transform(paraDecimalOuNaN)
  @Min(0.01, { message: 'Valor inválido. Use números, como 149,90.' })
  @Max(99_999_999_999, { message: 'Valor grande demais. Confira o que foi digitado.' })
  valor!: number
}

export class MeusLancamentosDto {
  @IsOptional()
  @Transform(({ value }) => Number(value ?? 7))
  @IsInt({ message: 'Período inválido.' })
  @Min(1, { message: 'Período inválido.' })
  @Max(90, { message: 'O operador vê no máximo 90 dias. Para além disso, é com o administrador.' })
  dias: number = 7
}

export class DiariasNoDiaDto {
  @IsUUID('all')
  funcionarioId!: string

  @Validate(DataISO)
  data!: string
}
