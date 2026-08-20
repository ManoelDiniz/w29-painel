import { Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { EntityManager } from 'typeorm'

import { ErroDeRegra } from '../comum/erros'
import { paraCentavos, paraDecimal, repartir } from '../comum/dinheiro'
import { EquipeMembro, Funcionario, Producao, ProducaoRateio } from '../entidades'

/**
 * O rateio: quem ganhou quanto em cada lançamento de produção.
 *
 * No Postgres isto era um TRIGGER (fn_gerar_rateio) — o banco não deixava
 * ninguém esquecer de chamá-lo. O MySQL até tem triggers, mas eles não
 * teriam como reusar nada disto, seriam invisíveis para quem lê o código, e
 * quebram silenciosamente numa restauração de dump feita por quem não sabe
 * que eles existem. Então virou um service.
 *
 * O preço dessa escolha: chamar isto agora é responsabilidade de quem
 * grava produção. Por isso o método é `recalcular`, é idempotente, e SEMPRE
 * recebe o EntityManager da transação de quem chamou — um rateio gravado
 * fora da transação do lançamento pode sobreviver a um rollback e virar
 * comissão de uma produção que não existe.
 */
@Injectable()
export class RateioService {
  async recalcular(gerente: EntityManager, producaoId: string): Promise<void> {
    const producao = await gerente.findOne(Producao, { where: { id: producaoId } })
    if (!producao) return

    const rateios = gerente.getRepository(ProducaoRateio)

    // Mexer num lançamento já pago reabriria uma conta fechada: o dinheiro
    // já saiu, e recalcular mudaria o valor de um pagamento que existe.
    const temPago = await gerente
      .createQueryBuilder(ProducaoRateio, 'r')
      .where('r.producaoId = :producaoId', { producaoId })
      .andWhere('r.pagamentoId IS NOT NULL')
      .getExists()

    if (temPago) {
      throw new ErroDeRegra(
        'Esse lançamento já teve a comissão paga e não pode mais ser alterado.',
      )
    }

    // Apaga e refaz em vez de tentar atualizar linha a linha: mudar de
    // equipe altera quem são os beneficiários, e um update deixaria para
    // trás a comissão de quem saiu.
    await rateios.delete({ producaoId })

    const beneficiarios = await this.beneficiarios(gerente, producao)
    if (beneficiarios.length === 0) return

    // O bolo vem da coluna gerada pelo MySQL (quantidade × valor unitário),
    // e não de uma multiplicação aqui: assim o que é dividido é exatamente
    // o que está gravado.
    const partes = repartir(paraCentavos(producao.poolMaoObra), beneficiarios.length)

    await rateios.insert(
      beneficiarios.map((funcionarioId, i) => ({
        id: randomUUID(),
        producaoId,
        funcionarioId,
        valor: paraDecimal(partes[i]),
        pagamentoId: null,
      })),
    )
  }

  /**
   * Quem entra na divisão.
   *
   * Só quem é pago por produção. O diarista trabalhou e a produção dele
   * conta para o faturamento, mas o custo dele é a diária — se ele entrasse
   * aqui, o mesmo dia de trabalho seria pago duas vezes.
   *
   * A ordem é por nome, e importa: `repartir` dá a sobra de centavos ao
   * primeiro da lista, então uma ordem instável faria o mesmo lançamento
   * render um centavo a mais para pessoas diferentes a cada recálculo.
   */
  private async beneficiarios(gerente: EntityManager, producao: Producao): Promise<string[]> {
    if (producao.tipoExecutor === 'funcionario') {
      const f = await gerente.findOne(Funcionario, {
        where: { id: producao.funcionarioId! },
        select: ['id', 'regime'],
      })
      return f?.regime === 'producao' ? [f.id] : []
    }

    const membros = await gerente
      .createQueryBuilder(EquipeMembro, 'em')
      .innerJoin(Funcionario, 'f', 'f.id = em.funcionarioId')
      .where('em.equipeId = :equipeId', { equipeId: producao.equipeId! })
      .andWhere("f.regime = 'producao'")
      .orderBy('f.nome', 'ASC')
      .select('em.funcionarioId', 'id')
      .getRawMany<{ id: string }>()

    return membros.map((m) => m.id)
  }
}
