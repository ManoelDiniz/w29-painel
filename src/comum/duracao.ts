/** '7d' | '8h' | '15m' | '30s' -> milissegundos. */
export function paraMilissegundos(duracao: string): number {
  const m = /^(\d+)\s*([smhd])$/.exec(duracao.trim())
  if (!m) throw new Error(`Duração inválida: "${duracao}". Use algo como 15m, 8h ou 7d.`)

  const n = Number(m[1])
  const fator = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's' | 'm' | 'h' | 'd']
  return n * fator
}

/**
 * A mesma duração em segundos, que é a unidade que o JWT usa em `exp`.
 *
 * Existe para que o cookie e o token vençam no mesmo instante. Deixar cada
 * um com o seu número é como eles saem de sincronia: um cookie que dura
 * mais que o token faz a pessoa parecer logada até o primeiro clique dar
 * "sessão expirada".
 */
export function paraSegundos(duracao: string): number {
  return Math.floor(paraMilissegundos(duracao) / 1000)
}
