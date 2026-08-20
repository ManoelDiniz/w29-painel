import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common'

import { SoAdmin, UsuarioAtual, type UsuarioDaSessao } from '../auth/decoradores'
import {
  SalvarEquipeDto,
  SalvarFuncionarioDto,
  SalvarObraDto,
  SalvarServicoDto,
} from './cadastros.dto'
import { CadastrosService } from './cadastros.service'

/**
 * @SoAdmin() na CLASSE, e não em cada método.
 *
 * Aqui dentro passam valor de contrato, preço de venda e valor de diária —
 * tudo o que o operador não pode ver. Marcar a classe faz o método novo já
 * nascer protegido; marcar método a método faz o próximo esquecimento
 * virar um vazamento.
 */
@SoAdmin()
@Controller()
export class CadastrosController {
  constructor(private readonly servico: CadastrosService) {}

  @Get('painel')
  painel() {
    return this.servico.painel()
  }

  // --------------------------------------------------------------- obras

  @Get('obras')
  listarObras() {
    return this.servico.listarObras()
  }

  @Post('obras')
  criarObra(@Body() dto: SalvarObraDto, @UsuarioAtual() usuario: UsuarioDaSessao) {
    return this.servico.criarObra(dto, usuario)
  }

  @Put('obras/:id')
  atualizarObra(@Param('id') id: string, @Body() dto: SalvarObraDto) {
    return this.servico.atualizarObra(id, dto)
  }

  // ------------------------------------------------------------ serviços

  @Get('servicos')
  listarServicos() {
    return this.servico.listarServicos()
  }

  @Post('servicos')
  criarServico(@Body() dto: SalvarServicoDto) {
    return this.servico.criarServico(dto)
  }

  @Put('servicos/:id')
  atualizarServico(@Param('id') id: string, @Body() dto: SalvarServicoDto) {
    return this.servico.atualizarServico(id, dto)
  }

  // -------------------------------------------------------- funcionários

  @Get('funcionarios')
  listarFuncionarios() {
    return this.servico.listarFuncionarios()
  }

  @Post('funcionarios')
  criarFuncionario(@Body() dto: SalvarFuncionarioDto) {
    return this.servico.criarFuncionario(dto)
  }

  @Put('funcionarios/:id')
  atualizarFuncionario(@Param('id') id: string, @Body() dto: SalvarFuncionarioDto) {
    return this.servico.atualizarFuncionario(id, dto)
  }

  // ------------------------------------------------------------- equipes

  @Get('equipes')
  listarEquipes() {
    return this.servico.listarEquipes()
  }

  @Post('equipes')
  criarEquipe(@Body() dto: SalvarEquipeDto) {
    return this.servico.criarEquipe(dto)
  }

  @Put('equipes/:id')
  atualizarEquipe(@Param('id') id: string, @Body() dto: SalvarEquipeDto) {
    return this.servico.atualizarEquipe(id, dto)
  }
}
