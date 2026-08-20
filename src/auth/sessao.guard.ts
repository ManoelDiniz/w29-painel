import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { InjectRepository } from '@nestjs/typeorm'
import type { Request } from 'express'
import { Repository } from 'typeorm'

import { Usuario, type Papel } from '../entidades'
import { CHAVE_PAPEIS, CHAVE_PUBLICO, type UsuarioDaSessao } from './decoradores'

export const NOME_COOKIE = 'w29_sessao'

/** O que vai assinado dentro do token. */
export type Conteudo = { sub: string; papel: Papel }

/**
 * O porteiro. Roda em TODA requisição (é registrado como APP_GUARD).
 *
 * No Supabase esse papel era do banco: a RLS olhava `auth.uid()` linha a
 * linha. Com MySQL isso não existe, então a checagem inteira acontece aqui
 * — e é por isso que o guard vai ao banco a cada request em vez de confiar
 * no que está escrito no token. O token diz "papel: admin" e continua
 * dizendo isso por sete dias, mesmo depois de o admin desativar a conta.
 * Uma consulta por request é barata; um demitido com acesso não é.
 */
@Injectable()
export class SessaoGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @InjectRepository(Usuario) private readonly usuarios: Repository<Usuario>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const publico = this.reflector.getAllAndOverride<boolean>(CHAVE_PUBLICO, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (publico) return true

    const req = ctx.switchToHttp().getRequest<Request>()
    const token = this.extrairToken(req)

    if (!token) {
      throw new UnauthorizedException({ erro: 'Você precisa entrar para fazer isso.' })
    }

    let conteudo: Conteudo
    try {
      conteudo = await this.jwt.verifyAsync<Conteudo>(token)
    } catch {
      // Expirado, assinado com outro segredo, ou adulterado — do ponto de
      // vista de quem está na tela, é tudo a mesma coisa: entre de novo.
      throw new UnauthorizedException({ erro: 'Sua sessão expirou. Entre de novo.' })
    }

    const usuario = await this.usuarios.findOne({
      where: { id: conteudo.sub },
      select: ['id', 'nome', 'email', 'papel', 'ativo'],
    })

    if (!usuario || !usuario.ativo) {
      throw new UnauthorizedException({
        erro: 'Sua conta não está mais ativa. Fale com o administrador.',
      })
    }

    const daSessao: UsuarioDaSessao = {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      // Do banco, nunca do token: se o admin rebaixou alguém agora há
      // pouco, é o banco que sabe disso.
      papel: usuario.papel,
    }
    ;(req as Request & { usuario: UsuarioDaSessao }).usuario = daSessao

    const exigidos = this.reflector.getAllAndOverride<Papel[]>(CHAVE_PAPEIS, [
      ctx.getHandler(),
      ctx.getClass(),
    ])

    if (exigidos?.length && !exigidos.includes(usuario.papel)) {
      throw new ForbiddenException({ erro: 'Só o administrador pode fazer isso.' })
    }

    return true
  }

  /**
   * O cookie vem primeiro porque é o caminho normal do navegador.
   *
   * O Bearer existe para o que não tem cookie: um curl conferindo a API,
   * um script de importação. Aceitar os dois não enfraquece nada — o token
   * é o mesmo e é verificado do mesmo jeito.
   */
  private extrairToken(req: Request): string | null {
    const doCookie = (req.cookies as Record<string, string> | undefined)?.[NOME_COOKIE]
    if (doCookie) return doCookie

    const cabecalho = req.headers.authorization
    if (cabecalho?.startsWith('Bearer ')) return cabecalho.slice(7).trim()

    return null
  }
}
