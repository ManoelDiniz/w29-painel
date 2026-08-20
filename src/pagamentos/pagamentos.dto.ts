import { Transform } from 'class-transformer'
import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator'

/**
 * Registrar um pagamento.
 *
 * Repare no que NÃO tem aqui: o valor.
 *
 * Ele é somado no servidor, a partir do que está pendente até a data de
 * referência. Se viesse do formulário, o admin poderia gravar R$ 900 quitando
 * R$ 1.040 de comissão — e aí o pagamento diz uma coisa e as linhas que ele
 * quitou dizem outra, sem ninguém para arbitrar. É a mesma razão de o
 * operador não digitar preço: quem tem o número é o cadastro, não a tela.
 */
export class RegistrarPagamentoDto {
  @IsUUID('all', { message: 'Escolha o funcionário.' })
  funcionarioId!: string

  /**
   * Paga tudo o que está pendente ATÉ este dia, ele incluído.
   *
   * Existe para o fechamento de quinzena ou de mês não arrastar junto o que
   * foi lançado hoje de manhã, depois de a conta já ter sido fechada.
   */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data de referência inválida.' })
  referenciaAte!: string

  @IsOptional()
  @Transform(({ value }) => {
    const v = String(value ?? '').trim()
    return v === '' ? null : v
  })
  @IsString()
  @MaxLength(2000, { message: 'A observação ficou longa demais.' })
  observacao?: string | null
}
