import type { CookieOptions, Response } from 'express'

import { env } from '../config/env'
import { NOME_COOKIE } from '../auth/sessao.guard'
import { paraMilissegundos } from './duracao'

/**
 * Como o cookie de sessão sai daqui.
 *
 * O caso difícil é o front na Vercel e a API na VPS: domínios diferentes,
 * então o navegador trata o cookie como de terceiro e só o aceita com
 * SameSite=None + Secure. É o que este código faz quando COOKIE_DOMINIO
 * está vazio.
 *
 * Vale saber que isso é frágil por natureza: Safari e o modo anônimo do
 * Chrome bloqueiam cookie de terceiro por padrão, e a sessão simplesmente
 * não gruda. A saída é pôr os dois sob o mesmo domínio (app.seudominio.com
 * e api.seudominio.com) e preencher COOKIE_DOMINIO com ".seudominio.com" —
 * aí o cookie vira same-site e o problema deixa de existir.
 */
function opcoes(): CookieOptions {
  const mesmoDominio = Boolean(env.cookieDominio)

  return {
    httpOnly: true,
    // Sem httpOnly qualquer script da página lê o token; com ele, um XSS
    // ainda faz estrago, mas não sai com a sessão no bolso.
    secure: env.producao || !mesmoDominio,
    sameSite: mesmoDominio ? 'lax' : 'none',
    domain: env.cookieDominio,
    path: '/',
  }
}

export function gravarCookieSessao(res: Response, token: string): void {
  res.cookie(NOME_COOKIE, token, {
    ...opcoes(),
    maxAge: paraMilissegundos(env.jwt.validade),
  })
}

/**
 * Apagar cookie é gravar o mesmo cookie vazio e vencido — e com EXATAMENTE
 * os mesmos atributos de domínio e path. Um `domain` diferente aqui cria um
 * segundo cookie em vez de apagar o primeiro, e a pessoa continua logada
 * depois de clicar em "Sair".
 */
export function limparCookieSessao(res: Response): void {
  res.clearCookie(NOME_COOKIE, opcoes())
}
