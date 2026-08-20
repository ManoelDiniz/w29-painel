import { Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { DataSource, EntityManager } from 'typeorm'

import type { UsuarioDaSessao } from '../auth/decoradores'
import { paraCentavos, paraDecimal } from '../comum/dinheiro'
import { ErroDeRegra } from '../comum/erros'
import { Pagamento } from '../entidades'
import type { RegistrarPagamentoDto } from './pagamentos.dto'

/** O que está devendo para uma pessoa, sem detalhar. */
type Saldo = {
  funcionarioId: string
  nome: string
  regime: string
  comissoes: string
  diarias: string
  total: string
}

/** Uma linha que um pagamento vai quitar. */
type Pendencia = {
  tipo: 'comissao' | 'diaria'
  id: string
  data: string
  descricao: string
  valor: string
}

/**
 * O fechamento: registrar que o dinheiro saiu.
 *
 * Sem isto o resto do sistema é meia conta. Ele sabe somar o que cada um
 * ganhou e nunca sabe que já foi pago — então o "a pagar" cresce para sempre,
 * e em dois meses o número não significa mais nada.
 *
 * A regra que atravessa este arquivo: **o valor de um pagamento nunca é
 * digitado.** Ele é a soma exata das linhas que aquele pagamento carimba.
 * Um total que possa divergir das suas partes é um total em que ninguém
 * confia — e a discussão volta para o papel.
 */
@Injectable()
export class PagamentosService {
  constructor(private readonly dataSource: DataSource) {}

  /** Quem tem algo a receber hoje. */
  async saldos(): Promise<Saldo[]> {
    return this.dataSource.query(`
      SELECT id AS funcionarioId,
             nome,
             regime,
             comissoesPendentes AS comissoes,
             diariasPendentes   AS diarias,
             totalAPagar        AS total
        FROM vw_saldo_funcionarios
       WHERE totalAPagar > 0
       ORDER BY totalAPagar DESC
    `)
  }

  /**
   * O extrato do que um pagamento vai quitar, linha por linha.
   *
   * Existe para o admin conferir ANTES de confirmar. Pagar contra um total
   * fechado, sem ver de onde ele veio, é como assinar cheque em branco — e
   * quando o funcionário reclamar, não há o que mostrar a ele.
   */
  async pendencias(funcionarioId: string, ate: string) {
    const linhas: Pendencia[] = await this.dataSource.query(
      `
      SELECT 'comissao' AS tipo, r.id, p.data,
             CONCAT(s.nome, ' — ', FORMAT(p.quantidade, 2, 'de_DE'),
                    CASE p.unidade WHEN 'm2' THEN ' m²' WHEN 'metro_linear' THEN ' m' ELSE ' un' END,
                    ' · ', o.nome) AS descricao,
             r.valor
        FROM producao_rateios r
        JOIN producoes p ON p.id = r.producaoId
        JOIN servicos s  ON s.id = p.servicoId
        JOIN obras o     ON o.id = p.obraId
       WHERE r.funcionarioId = ? AND r.pagamentoId IS NULL AND p.data <= ?

      UNION ALL

      SELECT 'diaria', d.id, d.data, 'Diária', d.valor
        FROM diarias d
       WHERE d.funcionarioId = ? AND d.pagamentoId IS NULL AND d.data <= ?

      ORDER BY data ASC
      `,
      [funcionarioId, ate, funcionarioId, ate],
    )

    const total = linhas.reduce((s, l) => s + paraCentavos(l.valor), 0)

    return { linhas, total: paraDecimal(total), quantidade: linhas.length }
  }

  /**
   * Registrar o pagamento.
   *
   * Tudo numa transação, e as linhas travadas com FOR UPDATE: dois admins
   * clicando ao mesmo tempo pagariam o mesmo rateio duas vezes, cada um
   * gerando um pagamento com o total cheio. O trabalho seria pago em dobro e
   * os dois registros pareceriam corretos isoladamente.
   */
  async registrar(dto: RegistrarPagamentoDto, usuario: UsuarioDaSessao) {
    return this.dataSource.transaction(async (gerente) => {
      const funcionario = await gerente.query(
        'SELECT id, nome FROM funcionarios WHERE id = ?',
        [dto.funcionarioId],
      )
      if (funcionario.length === 0) {
        throw new ErroDeRegra('Funcionário não encontrado.')
      }

      const rateios = await this.travarPendentes(
        gerente,
        `SELECT r.id, r.valor
           FROM producao_rateios r
           JOIN producoes p ON p.id = r.producaoId
          WHERE r.funcionarioId = ? AND r.pagamentoId IS NULL AND p.data <= ?
          FOR UPDATE`,
        [dto.funcionarioId, dto.referenciaAte],
      )

      const diarias = await this.travarPendentes(
        gerente,
        `SELECT id, valor
           FROM diarias
          WHERE funcionarioId = ? AND pagamentoId IS NULL AND data <= ?
          FOR UPDATE`,
        [dto.funcionarioId, dto.referenciaAte],
      )

      const centavos =
        rateios.reduce((s, r) => s + paraCentavos(r.valor), 0) +
        diarias.reduce((s, d) => s + paraCentavos(d.valor), 0)

      if (centavos <= 0) {
        throw new ErroDeRegra(
          `Não há nada pendente para ${funcionario[0].nome} até ${dto.referenciaAte.split('-').reverse().join('/')}.`,
        )
      }

      const id = randomUUID()

      await gerente.insert(Pagamento, {
        id,
        funcionarioId: dto.funcionarioId,
        valorTotal: paraDecimal(centavos),
        referenciaAte: dto.referenciaAte,
        observacao: dto.observacao ?? null,
        criadoPor: usuario.id,
      })

      // Carimbar é o que torna estas linhas imutáveis daqui em diante: o
      // rateio recusa recálculo e o lançamento recusa exclusão quando já
      // têm pagamentoId. É de propósito — mexer no que já foi pago
      // reabriria uma conta fechada.
      if (rateios.length > 0) {
        await gerente.query(
          'UPDATE producao_rateios SET pagamentoId = ? WHERE id IN (?)',
          [id, rateios.map((r) => r.id)],
        )
      }
      if (diarias.length > 0) {
        await gerente.query('UPDATE diarias SET pagamentoId = ? WHERE id IN (?)', [
          id,
          diarias.map((d) => d.id),
        ])
      }

      return {
        id,
        funcionario: funcionario[0].nome,
        valorTotal: paraDecimal(centavos),
        comissoes: rateios.length,
        diarias: diarias.length,
      }
    })
  }

  /**
   * O histórico, do mais recente para o mais antigo.
   *
   * Os COUNT voltam do mysql2 como STRING ('1', não 1) — DECIMAL e agregados
   * chegam assim para não perder precisão em números grandes. Converter aqui
   * e não na tela: quem consome não tem como adivinhar que dois campos
   * numéricos vêm como texto, e `"1" === 1` é falso em silêncio. Foi
   * exatamente isso que fez a tela escrever "1 comissões".
   */
  async listar() {
    const linhas: Record<string, unknown>[] = await this.dataSource.query(`
      SELECT pg.id,
             pg.valorTotal,
             pg.referenciaAte,
             pg.observacao,
             pg.pagoEm,
             f.nome AS funcionario,
             u.nome AS registradoPor,
             (SELECT COUNT(*) FROM producao_rateios WHERE pagamentoId = pg.id) AS comissoes,
             (SELECT COUNT(*) FROM diarias         WHERE pagamentoId = pg.id) AS diarias
        FROM pagamentos pg
        JOIN funcionarios f ON f.id = pg.funcionarioId
        JOIN usuarios u     ON u.id = pg.criadoPor
       ORDER BY pg.pagoEm DESC
       LIMIT 200
    `)

    return linhas.map((l) => ({
      ...l,
      comissoes: Number(l.comissoes),
      diarias: Number(l.diarias),
    }))
  }

  /**
   * Estornar um pagamento registrado por engano.
   *
   * As duas FKs são ON DELETE SET NULL, então apagar o pagamento devolve
   * sozinho as linhas para "pendente" — sem UPDATE manual que possa esquecer
   * metade e deixar comissão carimbada apontando para um pagamento que não
   * existe mais.
   *
   * Isto NÃO desfaz dinheiro que saiu da conta: desfaz o registro. Quem
   * estorna precisa saber que o envelope continua entregue.
   */
  async estornar(id: string) {
    const resultado = await this.dataSource.getRepository(Pagamento).delete({ id })

    if (resultado.affected === 0) {
      throw new NotFoundException({ erro: 'Pagamento não encontrado.' })
    }
  }

  /**
   * `FOR UPDATE` só funciona dentro de transação, e é a trava que impede
   * dois fechamentos simultâneos de quitarem o mesmo rateio.
   */
  private travarPendentes(
    gerente: EntityManager,
    sql: string,
    params: unknown[],
  ): Promise<{ id: string; valor: string }[]> {
    return gerente.query(sql, params)
  }
}
