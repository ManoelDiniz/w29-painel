import { describe, expect, it } from 'vitest'

import { dataValida, diasAtras, hoje } from './datas'
import { paraMilissegundos, paraSegundos } from './duracao'

describe('dataValida', () => {
  it('aceita o formato do banco', () => {
    expect(dataValida('2026-08-20')).toBe(true)
    expect(dataValida('2024-02-29')).toBe(true) // bissexto de verdade
  })

  it('recusa dia que não existe', () => {
    // 2026-02-30 casa com o regex e o Date normaliza para 2 de março. Sem a
    // volta pelo toISOString, uma diária entraria com data de outro dia.
    expect(dataValida('2026-02-30')).toBe(false)
    expect(dataValida('2026-13-01')).toBe(false)
    expect(dataValida('2025-02-29')).toBe(false) // 2025 não é bissexto
  })

  it('recusa outros formatos', () => {
    expect(dataValida('20/08/2026')).toBe(false)
    expect(dataValida('2026-8-20')).toBe(false)
    expect(dataValida('')).toBe(false)
    expect(dataValida('ontem')).toBe(false)
  })
})

describe('hoje e diasAtras', () => {
  it('devolvem o formato aceito pelo MySQL e pelo input date', () => {
    expect(hoje()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(diasAtras(7)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('diasAtras anda para trás', () => {
    expect(diasAtras(1) < hoje()).toBe(true)
    expect(diasAtras(30) < diasAtras(7)).toBe(true)
  })

  it('diasAtras(0) é hoje', () => {
    expect(diasAtras(0)).toBe(hoje())
  })

  /**
   * A razão de `hoje()` existir em vez de um `new Date()`.
   *
   * A VPS roda em UTC e a obra fica no Brasil. Às 21h30 em São Paulo já é o
   * dia seguinte em UTC — e a checagem de "não dá para lançar com data
   * futura" passaria a aceitar amanhã durante as últimas três horas de todo
   * dia. Só de noite, o que faz o bug parecer aleatório para quem reporta.
   */
  it('usa o fuso da obra, não o do servidor', () => {
    const emUtc = new Date().toISOString().slice(0, 10)
    const naObra = hoje()

    // São Paulo está atrás de UTC, então ou é o mesmo dia, ou a obra está
    // um dia atrás. Nunca à frente.
    expect(naObra <= emUtc).toBe(true)
  })
})

describe('duração', () => {
  it('entende as unidades que o .env aceita', () => {
    expect(paraMilissegundos('30s')).toBe(30_000)
    expect(paraMilissegundos('15m')).toBe(900_000)
    expect(paraMilissegundos('8h')).toBe(28_800_000)
    expect(paraMilissegundos('7d')).toBe(604_800_000)
  })

  it('recusa o que não souber ler, em vez de assumir um padrão', () => {
    // Assumir um padrão faria JWT_VALIDADE='7 dias' virar sessão de um
    // valor qualquer, sem ninguém saber qual.
    expect(() => paraMilissegundos('7 dias')).toThrow()
    expect(() => paraMilissegundos('7')).toThrow()
    expect(() => paraMilissegundos('')).toThrow()
  })

  it('segundos e milissegundos falam da MESMA duração', () => {
    // É o que mantém o cookie e o token vencendo juntos. Divergindo, a
    // pessoa parece logada até o primeiro clique dar "sessão expirada".
    for (const d of ['30s', '15m', '8h', '7d']) {
      expect(paraSegundos(d) * 1000).toBe(paraMilissegundos(d))
    }
  })
})
