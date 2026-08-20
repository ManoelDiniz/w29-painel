import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common'

import { SoAdmin, UsuarioAtual, type UsuarioDaSessao } from '../auth/decoradores'
import { hoje } from '../comum/datas'
import { RegistrarPagamentoDto } from './pagamentos.dto'
import { PagamentosService } from './pagamentos.service'

/**
 * O fechamento. @SoAdmin() na classe inteira: aqui passa quanto cada
 * funcionário tem a receber, o que é o dado mais sensível do sistema depois
 * da margem.
 */
@SoAdmin()
@Controller('pagamentos')
export class PagamentosController {
  constructor(private readonly servico: PagamentosService) {}

  /** Quem tem algo a receber hoje. */
  @Get('saldos')
  saldos() {
    return this.servico.saldos()
  }

  /**
   * O extrato de um funcionário — o que um pagamento até `ate` vai quitar.
   *
   * Sem `ate`, assume hoje. A data padrão vem do fuso da obra e não do
   * relógio do servidor: em UTC, às 21h de São Paulo já é amanhã, e o
   * extrato traria a produção de um dia que ainda não terminou.
   */
  @Get('pendencias/:funcionarioId')
  pendencias(
    @Param('funcionarioId') funcionarioId: string,
    @Query('ate') ate?: string,
  ) {
    const limite = ate && /^\d{4}-\d{2}-\d{2}$/.test(ate) ? ate : hoje()
    return this.servico.pendencias(funcionarioId, limite)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  registrar(
    @Body() dto: RegistrarPagamentoDto,
    @UsuarioAtual() usuario: UsuarioDaSessao,
  ) {
    return this.servico.registrar(dto, usuario)
  }

  @Get()
  listar() {
    return this.servico.listar()
  }

  /** Estorna o REGISTRO, não o dinheiro. Ver o comentário no service. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async estornar(@Param('id') id: string): Promise<void> {
    await this.servico.estornar(id)
  }
}
