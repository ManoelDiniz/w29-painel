/**
 * Dinheiro em centavos, sempre.
 *
 * O motivo é o de sempre: 0.1 + 0.2 dá 0.30000000000000004 em ponto
 * flutuante. Num sistema que divide mão de obra entre quatro pedreiros e
 * soma isso no fim do mês, esse resto vira diferença de verdade no
 * envelope de alguém. Então toda conta acontece em inteiros, e a volta
 * para decimal só na hora de gravar.
 */

/**
 * Interpreta um número escrito por gente: 'R$ 1.234,56' -> 1234.56.
 *
 * Ele APENAS interpreta. Não recusa zero, não recusa negativo — quem cuida
 * de faixa são os @Min/@Max dos DTOs, que sabem o que cada campo aceita
 * (quantidade > 0, valor por serviço >= 0).
 *
 * O nome é `interpretarNumero` e não `paraNumero` de propósito: o front tem
 * um `paraNumero` que RECUSA zero e negativo. Dois nomes iguais com
 * contratos diferentes nos dois lados do projeto era um convite a mover
 * código de um para o outro e mudar a regra sem perceber.
 */
export function interpretarNumero(texto: string): number | null {
  const limpo = texto.replace(/[^\d,.-]/g, '').trim()
  if (limpo === '') return null

  // Quem manda é o ÚLTIMO separador: em '1.234,56' a vírgula é decimal;
  // em '1,234.56' é o ponto. Assumir um dos dois erra silenciosamente por
  // um fator de mil — e um gasto de 1.234,56 vira 1,23.
  const ultimaVirgula = limpo.lastIndexOf(',')
  const ultimoPonto = limpo.lastIndexOf('.')

  let normalizado: string
  if (ultimaVirgula > ultimoPonto) {
    normalizado = limpo.replace(/\./g, '').replace(',', '.')
  } else if (ultimoPonto > ultimaVirgula) {
    normalizado = limpo.replace(/,/g, '')
  } else {
    normalizado = limpo
  }

  const n = Number(normalizado)
  return Number.isFinite(n) ? n : null
}

/** Decimal (o que o MySQL devolve como string) -> centavos inteiros. */
export function paraCentavos(valor: string | number): number {
  return Math.round(Number(valor) * 100)
}

/** Centavos -> a string decimal que vai para uma coluna DECIMAL(_,2). */
export function paraDecimal(centavos: number): string {
  return (centavos / 100).toFixed(2)
}

/**
 * Divide um bolo entre n pessoas sem perder nem inventar centavo.
 *
 * A sobra da divisão inteira vai toda para o primeiro da lista. Não é o
 * mais justo possível — é o mais simples de conferir, e a soma das partes
 * bate exatamente com o total, que é o que impede dinheiro de evaporar
 * entre a produção e o fechamento.
 */
export function repartir(totalCentavos: number, n: number): number[] {
  if (n <= 0) return []

  const cota = Math.trunc(totalCentavos / n)
  const sobra = totalCentavos - cota * n

  return Array.from({ length: n }, (_, i) => (i === 0 ? cota + sobra : cota))
}
