import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import type { Response } from 'express'
import { QueryFailedError } from 'typeorm'

/**
 * Todo erro que sai desta API sai no mesmo formato: { erro: string }.
 *
 * A mensagem é escrita para o pedreiro de bota na obra, não para mim. Ela
 * diz o que aconteceu e o que fazer — nunca "constraint violation".
 */
export type RespostaErro = { erro: string }

/**
 * Erro de regra de negócio: a requisição está bem formada, o sistema
 * entendeu, e mesmo assim a resposta é não.
 *
 * Separado de BadRequest porque a mensagem já vem pronta para a tela.
 */
export class ErroDeRegra extends HttpException {
  constructor(mensagem: string, status: HttpStatus = HttpStatus.CONFLICT) {
    super({ erro: mensagem }, status)
  }
}

type ErroMysql = { code?: string; errno?: number; sqlMessage?: string }

/**
 * Traduz o que o MySQL reclama.
 *
 * Isto existe porque as regras vivem em dois lugares: no CHECK do banco e
 * no service. O service checa antes e erra bonito — mas o banco é a última
 * palavra, e quando ELE recusa (uma corrida entre dois requests, um insert
 * que escapou de uma validação) a mensagem crua vazaria para a tela como
 * "Check constraint 'chk_margem' is violated". Aqui ela vira português.
 */
function traduzirMysql(erro: ErroMysql): string | null {
  const texto = (erro.sqlMessage ?? '').toLowerCase()

  if (texto.includes('chk_valor_diaria')) {
    return 'Diarista precisa de um valor de diária; quem é pago por produção não pode ter um.'
  }
  if (texto.includes('chk_margem')) {
    return 'O valor pago à equipe não pode ser maior que o valor cobrado do cliente. Confira os dois valores.'
  }
  if (texto.includes('chk_cep')) return 'CEP inválido. Use 8 números.'
  if (texto.includes('chk_executor')) {
    return 'Um lançamento é de uma pessoa OU de uma equipe — nunca dos dois.'
  }
  if (texto.includes('chk_quantidade')) return 'A quantidade precisa ser maior que zero.'
  if (texto.includes('chk_gasto_positivo') || texto.includes('chk_diaria_positiva')) {
    return 'O valor precisa ser maior que zero.'
  }

  switch (erro.code) {
    case 'ER_DUP_ENTRY':
      if (texto.includes('uq_usuarios_email')) {
        return 'Já existe uma conta com esse e-mail.'
      }
      return 'Já existe um cadastro com esse nome.'

    case 'ER_ROW_IS_REFERENCED':
    case 'ER_ROW_IS_REFERENCED_2':
      return 'Não dá para apagar: já existem lançamentos usando este cadastro. Marque como inativo.'

    case 'ER_NO_REFERENCED_ROW':
    case 'ER_NO_REFERENCED_ROW_2':
      return 'Um dos itens escolhidos não existe mais. Recarregue a página e tente de novo.'

    case 'ER_DATA_TOO_LONG':
      return 'Um dos campos ficou longo demais. Encurte o texto.'

    // O banco fora do ar não é culpa de quem está lançando, e a tela precisa
    // dizer isso — senão a pessoa fica corrigindo um formulário que está certo.
    case 'ECONNREFUSED':
    case 'PROTOCOL_CONNECTION_LOST':
    case 'ER_CON_COUNT_ERROR':
      return 'O banco de dados não respondeu. Tente de novo em instantes; se insistir, avise o administrador.'
  }

  return null
}

@Catch()
export class FiltroDeErros implements ExceptionFilter {
  private readonly log = new Logger('Erro')

  catch(erro: unknown, host: ArgumentsHost): void {
    const resposta = host.switchToHttp().getResponse<Response>()

    if (erro instanceof HttpException) {
      const corpo = erro.getResponse()
      const mensagem =
        typeof corpo === 'object' && corpo !== null && 'erro' in corpo
          ? String((corpo as RespostaErro).erro)
          : this.mensagemDeHttpException(corpo, erro)

      resposta.status(erro.getStatus()).json({ erro: mensagem })
      return
    }

    if (erro instanceof QueryFailedError) {
      const traduzido = traduzirMysql(erro.driverError as ErroMysql)

      // Sempre no log, mesmo quando traduzido: a tela mostra o português,
      // eu preciso do SQL para achar a causa.
      this.log.error(erro.message, erro.stack)

      resposta.status(traduzido ? HttpStatus.CONFLICT : HttpStatus.INTERNAL_SERVER_ERROR).json({
        erro:
          traduzido ??
          'Não consegui gravar isso no banco. O administrador precisa olhar o log da API.',
      })
      return
    }

    // Qualquer outra coisa é bug meu. O detalhe vai para o log, não para a
    // tela: mensagem de erro crua costuma entregar caminho de arquivo,
    // nome de tabela e às vezes o próprio valor que falhou.
    this.log.error(erro instanceof Error ? erro.message : String(erro), erro instanceof Error ? erro.stack : undefined)

    resposta.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      erro: 'Deu um erro inesperado aqui no servidor. Tente de novo; se insistir, avise o administrador.',
    })
  }

  /** Mensagem de erro do Nest (validação de DTO, 404 de rota) em português. */
  private mensagemDeHttpException(corpo: unknown, erro: HttpException): string {
    if (typeof corpo === 'string') return corpo

    if (typeof corpo === 'object' && corpo !== null && 'message' in corpo) {
      const m = (corpo as { message: unknown }).message
      // O ValidationPipe devolve um array de mensagens; a tela mostra uma.
      if (Array.isArray(m) && m.length > 0) return String(m[0])
      if (typeof m === 'string') return m
    }

    return erro.message
  }
}
