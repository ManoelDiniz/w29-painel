/**
 * Lê e valida o ambiente uma vez, na partida.
 *
 * A alternativa — ler process.env espalhado pelo código — faz uma variável
 * faltando virar `undefined` e só explodir mais tarde, no meio de um
 * request, com uma mensagem que não ajuda ninguém. Aqui o processo se
 * recusa a subir e diz o que preencher.
 */

function obrigatoria(nome: string): string {
  const valor = process.env[nome]
  if (!valor || valor.trim() === '') {
    throw new Error(
      `Variável de ambiente ${nome} não está definida.\n` +
        `Copie o .env.example para .env e preencha antes de subir a API.`,
    )
  }
  return valor.trim()
}

function opcional(nome: string, padrao: string): string {
  const valor = process.env[nome]
  return valor && valor.trim() !== '' ? valor.trim() : padrao
}

const segredo = obrigatoria('JWT_SEGREDO')

// Um segredo curto é adivinhável, e quem adivinha o segredo assina um
// token de admin. 32 caracteres é o mínimo que ainda dá trabalho.
if (segredo.length < 32) {
  throw new Error(
    'JWT_SEGREDO é curto demais (mínimo 32 caracteres).\n' +
      'Gere um assim: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
  )
}

export const env = {
  producao: process.env.NODE_ENV === 'production',
  porta: Number(opcional('PORTA', '3333')),

  origens: opcional('ORIGENS_PERMITIDAS', 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean),

  db: {
    host: opcional('DB_HOST', '127.0.0.1'),
    porta: Number(opcional('DB_PORTA', '3306')),
    usuario: obrigatoria('DB_USUARIO'),
    senha: process.env.DB_SENHA ?? '',
    nome: obrigatoria('DB_NOME'),
  },

  jwt: {
    segredo,
    validade: opcional('JWT_VALIDADE', '7d'),
  },

  // Vazio = front e API em domínios diferentes (o caso Vercel + VPS).
  cookieDominio: process.env.COOKIE_DOMINIO?.trim() || undefined,
}
