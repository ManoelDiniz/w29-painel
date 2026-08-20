import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common'

import type { Papel } from '../entidades'

export const CHAVE_PUBLICO = 'rota_publica'
export const CHAVE_PAPEIS = 'papeis_exigidos'

/**
 * Abre a rota para quem não está logado.
 *
 * O guard é global, então o padrão é fechado: uma rota nova nasce exigindo
 * sessão, e só se abre por escrito. É o contrário do padrão comum (guard
 * por rota), e de propósito — a rota que alguém esquece de proteger é
 * sempre a que vaza.
 */
export const Publico = () => SetMetadata(CHAVE_PUBLICO, true)

/**
 * Só admin passa.
 *
 * Isto é o que sobrou da RLS: no Postgres, `fn_e_admin()` protegia a LINHA,
 * então uma rota esquecida ainda esbarrava no banco. No MySQL não há essa
 * segunda muralha — este decorador é a única. Toda rota que devolve preço
 * de venda, valor de contrato, comissão ou saldo precisa dele.
 */
export const SoAdmin = () => SetMetadata(CHAVE_PAPEIS, ['admin'] as Papel[])

export type UsuarioDaSessao = {
  id: string
  nome: string
  email: string
  papel: Papel
}

/** O usuário que o guard já validou e carregou. */
export const UsuarioAtual = createParamDecorator(
  (_dado: unknown, ctx: ExecutionContext): UsuarioDaSessao => {
    return ctx.switchToHttp().getRequest().usuario as UsuarioDaSessao
  },
)
