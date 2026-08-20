/**
 * Que dia é hoje na obra.
 *
 * Parece bobo ter uma função para isso, mas a VPS quase sempre roda em UTC
 * e a obra fica no Brasil. Às 21h30 de terça em São Paulo já é quarta em
 * UTC — e a checagem de "não dá para lançar com data futura" passaria a
 * aceitar o dia seguinte durante as últimas três horas de todo dia. Pior:
 * só de noite, o que faz o bug parecer aleatório para quem reporta.
 *
 * O fuso é fixo em America/Sao_Paulo porque a empresa está aqui. Se um dia
 * houver obra noutro fuso, isto vira configuração — não um `new Date()`
 * espalhado pelo código.
 */
const FUSO = 'America/Sao_Paulo'

/** O dia de hoje no fuso da obra, como 'YYYY-MM-DD'. */
export function hoje(): string {
  // 'en-CA' formata como YYYY-MM-DD, que é exatamente o formato do DATE do
  // MySQL — e comparável como string, sem virar Date no meio do caminho.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** 'YYYY-MM-DD' de N dias atrás, no fuso da obra. */
export function diasAtras(dias: number): string {
  const agora = new Date()
  agora.setUTCDate(agora.getUTCDate() - dias)

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora)
}

/** Aceita só 'YYYY-MM-DD' — e um dia que exista de verdade. */
export function dataValida(texto: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false

  // 2026-02-30 casa com o regex. O Date normaliza para 02 de março, então
  // comparar a volta com a ida é o que rejeita o dia que não existe.
  const d = new Date(`${texto}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto
}
