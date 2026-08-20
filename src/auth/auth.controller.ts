import { Body, Controller, Get, HttpCode, HttpStatus, Post, Res } from '@nestjs/common'
import type { Response } from 'express'

import { gravarCookieSessao, limparCookieSessao } from '../comum/cookie'
import { AuthService } from './auth.service'
import { CadastrarDto, EntrarDto } from './auth.dto'
import { Publico, UsuarioAtual, type UsuarioDaSessao } from './decoradores'

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * O token vai no cookie E no corpo.
   *
   * No cookie porque é o navegador que faz o trabalho: ele reenvia sozinho,
   * e httpOnly mantém o token fora do alcance de qualquer script.
   *
   * No corpo porque nem todo cliente tem cookie — um curl conferindo a API
   * ou um script de importação usam o Bearer. O front do navegador pode
   * simplesmente ignorar este campo.
   */
  @Publico()
  @Post('entrar')
  @HttpCode(HttpStatus.OK)
  async entrar(@Body() dto: EntrarDto, @Res({ passthrough: true }) res: Response) {
    const { usuario, token } = await this.auth.entrar(dto)
    gravarCookieSessao(res, token)
    return { usuario, token }
  }

  /**
   * Cadastro aberto: o primeiro que se cadastra vira admin, e é assim que
   * o sistema é instalado sem senha embutida em lugar nenhum.
   *
   * Depois disso a rota continua de pé e cria operadores. Se um dia a obra
   * crescer e isso incomodar, é aqui que se fecha — bastam um @SoAdmin() e
   * o admin passando a criar todo mundo por /usuarios.
   */
  @Publico()
  @Post('cadastrar')
  @HttpCode(HttpStatus.CREATED)
  async cadastrar(@Body() dto: CadastrarDto, @Res({ passthrough: true }) res: Response) {
    const { usuario, token } = await this.auth.cadastrar(dto)
    gravarCookieSessao(res, token)
    return { usuario, token }
  }

  /**
   * Sair é público de propósito: quem tem um token vencido também precisa
   * conseguir limpar o cookie. Exigir sessão válida aqui deixaria a pessoa
   * presa numa sessão morta que ela não consegue apagar.
   */
  @Publico()
  @Post('sair')
  @HttpCode(HttpStatus.OK)
  sair(@Res({ passthrough: true }) res: Response) {
    limparCookieSessao(res)
    return { ok: true }
  }

  /**
   * Quem sou eu. O front chama isto no carregamento para saber se mostra a
   * tela do admin, a do operador, ou manda para o login.
   */
  @Get('eu')
  eu(@UsuarioAtual() usuario: UsuarioDaSessao) {
    return usuario
  }
}
