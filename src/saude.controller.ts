import { Controller, Get, ServiceUnavailableException } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'

import { Publico } from './auth/decoradores'

/**
 * Para o Nginx, o systemd e para você, às onze da noite, querendo saber se
 * o problema é a API ou o banco.
 *
 * Não devolve versão, hostname nem nome de banco: é uma rota pública, e
 * cada detalhe desses é um dado a menos que quem varre a internet precisa
 * descobrir sozinho.
 */
@Controller('saude')
export class SaudeController {
  constructor(@InjectDataSource() private readonly banco: DataSource) {}

  @Publico()
  @Get()
  async saude() {
    try {
      await this.banco.query('SELECT 1')
      return { ok: true }
    } catch {
      // 503 e não 200 com { ok: false }: quem monitora olha o status HTTP,
      // e um 200 dizendo que está tudo errado não acorda ninguém.
      throw new ServiceUnavailableException({ erro: 'O banco de dados não respondeu.' })
    }
  }
}
