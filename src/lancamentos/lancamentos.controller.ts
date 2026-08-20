import {
  BadRequestException,
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

import { UsuarioAtual, type UsuarioDaSessao } from '../auth/decoradores'
import { TIPOS_LANCAMENTO, type TipoLancamento } from '../entidades'
import {
  DiariasNoDiaDto,
  LancarDiariaDto,
  LancarGastoDto,
  LancarProducaoDto,
  MeusLancamentosDto,
} from './lancamentos.dto'
import { LancamentosService } from './lancamentos.service'

/**
 * O trabalho do dia a dia. Todas as rotas aqui servem admin e operador —
 * o guard global já garantiu que há sessão, e o que cada um pode ver está
 * decidido dentro do service, coluna por coluna.
 */
@Controller('lancamentos')
export class LancamentosController {
  constructor(private readonly servico: LancamentosService) {}

  @Get('opcoes')
  opcoes() {
    return this.servico.opcoes()
  }

  @Get('meus')
  meus(@Query() dto: MeusLancamentosDto, @UsuarioAtual() usuario: UsuarioDaSessao) {
    return this.servico.meus(dto, usuario)
  }

  @Get('diarias-no-dia')
  diariasNoDia(@Query() dto: DiariasNoDiaDto) {
    return this.servico.diariasNoDia(dto)
  }

  @Post('producao')
  @HttpCode(HttpStatus.CREATED)
  lancarProducao(@Body() dto: LancarProducaoDto, @UsuarioAtual() usuario: UsuarioDaSessao) {
    return this.servico.lancarProducao(dto, usuario)
  }

  @Post('diaria')
  @HttpCode(HttpStatus.CREATED)
  lancarDiaria(@Body() dto: LancarDiariaDto, @UsuarioAtual() usuario: UsuarioDaSessao) {
    return this.servico.lancarDiaria(dto, usuario)
  }

  @Post('gasto')
  @HttpCode(HttpStatus.CREATED)
  lancarGasto(@Body() dto: LancarGastoDto, @UsuarioAtual() usuario: UsuarioDaSessao) {
    return this.servico.lancarGasto(dto, usuario)
  }

  /**
   * `tipo` vem da URL, então vale conferir que é um dos três antes de
   * deixá-lo escolher uma tabela lá dentro.
   */
  @Delete(':tipo/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async apagar(
    @Param('tipo') tipo: string,
    @Param('id') id: string,
    @UsuarioAtual() usuario: UsuarioDaSessao,
  ): Promise<void> {
    if (!(TIPOS_LANCAMENTO as readonly string[]).includes(tipo)) {
      throw new BadRequestException({ erro: `Tipo de lançamento desconhecido: ${tipo}` })
    }
    await this.servico.apagar(tipo as TipoLancamento, id, usuario)
  }
}
