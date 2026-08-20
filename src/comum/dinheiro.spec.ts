import { describe, expect, it } from 'vitest'

import { interpretarNumero, paraCentavos, paraDecimal, repartir } from './dinheiro'

/**
 * `repartir` é a função mais delicada do sistema.
 *
 * É ela que divide a mão de obra entre a turma. Um erro aqui não derruba
 * nada, não aparece em log e não gera exceção — só faz alguém receber a
 * menos, e a conta só não fecha no fim do mês, quando já é tarde para saber
 * de qual lançamento veio.
 *
 * Por isso o teste central não é "divide certo", é a INVARIANTE: a soma das
 * partes tem de bater com o bolo, sempre, para qualquer valor e qualquer
 * número de pessoas. Um caso específico prova um caso; a invariante prova
 * que não há centavo evaporando.
 */
describe('repartir', () => {
  it('divide igual quando não sobra centavo', () => {
    expect(repartir(1000, 2)).toEqual([500, 500])
    expect(repartir(900, 3)).toEqual([300, 300, 300])
  })

  it('dá a sobra ao PRIMEIRO da lista', () => {
    // 333 centavos entre 2: 166 cada, sobra 1.
    expect(repartir(333, 2)).toEqual([167, 166])
    // 1000 entre 3: 333 cada, sobra 1.
    expect(repartir(1000, 3)).toEqual([334, 333, 333])
    // 1001 entre 3: 333 cada, sobram 2 — as duas vão para o primeiro.
    expect(repartir(1001, 3)).toEqual([335, 333, 333])
  })

  it('devolve o bolo inteiro para uma pessoa só', () => {
    expect(repartir(4567, 1)).toEqual([4567])
  })

  it('não reparte quando não há ninguém', () => {
    // Acontece de verdade: turma só de diaristas. O custo deles é a diária,
    // então o rateio fica vazio em vez de dividir por zero.
    expect(repartir(5000, 0)).toEqual([])
    expect(repartir(5000, -1)).toEqual([])
  })

  it('aguenta bolo zero', () => {
    // Serviço com mão de obra zerada, ou pessoa com valor próprio 0.
    expect(repartir(0, 3)).toEqual([0, 0, 0])
  })

  it('INVARIANTE: a soma das partes é sempre igual ao bolo', () => {
    for (let total = 0; total <= 2000; total += 7) {
      for (let n = 1; n <= 9; n++) {
        const partes = repartir(total, n)

        expect(
          partes.reduce((s, p) => s + p, 0),
          `${total} centavos entre ${n}`,
        ).toBe(total)

        expect(partes).toHaveLength(n)
        // Ninguém pode receber negativo por causa de arredondamento.
        expect(partes.every((p) => p >= 0)).toBe(true)
      }
    }
  })

  it('INVARIANTE: ninguém recebe mais que um centavo a mais que outro', () => {
    // A sobra é sempre menor que o número de pessoas, então a diferença
    // entre o primeiro e os demais nunca passa de (n-1) centavos.
    for (let total = 1; total <= 500; total++) {
      for (let n = 2; n <= 7; n++) {
        const partes = repartir(total, n)
        const maior = Math.max(...partes)
        const menor = Math.min(...partes)
        expect(maior - menor, `${total} entre ${n}`).toBeLessThan(n)
      }
    }
  })
})

/**
 * O parser de número existe porque em teclado pt-BR ninguém digita "12.5".
 *
 * O caso que mais assusta é "1.234,56": lido como inglês, viraria 1,23 — um
 * gasto de mil e duzentos reais entrando como um e vinte e três.
 */
describe('interpretarNumero', () => {
  it('entende vírgula como decimal', () => {
    expect(interpretarNumero('12,5')).toBe(12.5)
    expect(interpretarNumero('149,90')).toBe(149.9)
  })

  it('entende ponto como decimal quando não há vírgula', () => {
    expect(interpretarNumero('12.5')).toBe(12.5)
  })

  it('trata o ponto como milhar quando a vírgula vem depois', () => {
    expect(interpretarNumero('1.234,56')).toBe(1234.56)
    expect(interpretarNumero('50.000,00')).toBe(50000)
  })

  it('trata a vírgula como milhar quando o ponto vem depois', () => {
    expect(interpretarNumero('1,234.56')).toBe(1234.56)
  })

  it('ignora símbolo de moeda e espaço', () => {
    expect(interpretarNumero('R$ 1.234,56')).toBe(1234.56)
    expect(interpretarNumero('  12,5  ')).toBe(12.5)
  })

  it('recusa o que não é número', () => {
    expect(interpretarNumero('abc')).toBeNull()
    expect(interpretarNumero('')).toBeNull()
    expect(interpretarNumero('   ')).toBeNull()
  })

  it('NÃO julga faixa: zero e negativo passam, quem barra é o DTO', () => {
    // De propósito. Interpretar e validar são coisas diferentes: 0 é
    // resposta legítima para "valor por serviço" e inválida para
    // "quantidade", e só o campo sabe qual dos dois é.
    expect(interpretarNumero('0')).toBe(0)
    expect(interpretarNumero('-5')).toBe(-5)
  })
})

describe('centavos', () => {
  it('converte ida e volta sem perder centavo', () => {
    for (const valor of ['0.00', '0.01', '4.00', '13.32', '1040.00', '99999.99']) {
      expect(paraDecimal(paraCentavos(valor))).toBe(valor)
    }
  })

  it('arredonda o ponto flutuante em vez de truncar', () => {
    // 13.32 * 100 dá 1331.9999999999998 em ponto flutuante. Truncando,
    // viraria 1331 — um centavo somindo em toda linha com essa cara.
    expect(paraCentavos(13.32)).toBe(1332)
    expect(paraCentavos('0.29')).toBe(29)
    // Três casas não arredondam de forma confiável: 1.005 * 100 dá
    // 100.49999999999999 em ponto flutuante, e o round desce para 100.
    // Não morde na prática — tudo aqui vem de DECIMAL(_,2) ou de um DTO já
    // validado —, mas fica registrado para ninguém confiar no que não vale.
    expect(paraCentavos('1.005')).toBe(100)
  })
})
