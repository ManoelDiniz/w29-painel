import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { randomUUID } from 'node:crypto'
import { DataSource, Repository } from 'typeorm'

import type { UsuarioDaSessao } from '../auth/decoradores'
import { diasAtras, hoje } from '../comum/datas'
import { ErroDeRegra } from '../comum/erros'
import {
  CategoriaGasto,
  Diaria,
  Equipe,
  Funcionario,
  FuncionarioServico,
  Gasto,
  Obra,
  Producao,
  ProducaoRateio,
  Servico,
  type TipoLancamento,
} from '../entidades'
import type {
  DiariasNoDiaDto,
  LancarDiariaDto,
  LancarGastoDto,
  LancarProducaoDto,
  MeusLancamentosDto,
} from './lancamentos.dto'
import { RateioService } from './rateio.service'

/**
 * O que o operador pode fazer.
 *
 * Uma regra atravessa este arquivo inteiro: **o operador nunca recebe
 * dinheiro que não seja o que ele mesmo digitou.** Nada de valor de venda,
 * de valor de contrato, de comissão, de diária de colega. Ele diz o que
 * aconteceu — "fulano fez 12,5 m² do serviço tal na obra tal" — e o preço
 * é buscado aqui, no servidor, do cadastro.
 *
 * Não é desconfiança do operador: é que o navegador dele é um lugar público.
 * Qualquer um que pegue o celular, abra o DevTools ou intercepte a resposta
 * vê tudo o que a API mandou. O que não desce, não vaza.
 *
 * No Postgres essa regra era mecânica: as RPCs eram `security definer` e o
 * operador não tinha SELECT nas tabelas com dinheiro. Aqui ela é humana —
 * mora nos SELECTs abaixo, que escolhem coluna por coluna. Ao mexer neles,
 * `SELECT *` é sempre a resposta errada.
 */
@Injectable()
export class LancamentosService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly rateio: RateioService,
    @InjectRepository(Obra) private readonly obras: Repository<Obra>,
    @InjectRepository(Servico) private readonly servicos: Repository<Servico>,
    @InjectRepository(Funcionario) private readonly funcionarios: Repository<Funcionario>,
    @InjectRepository(Equipe) private readonly equipes: Repository<Equipe>,
    @InjectRepository(CategoriaGasto) private readonly categorias: Repository<CategoriaGasto>,
    @InjectRepository(Diaria) private readonly diarias: Repository<Diaria>,
  ) {}

  // ------------------------------------------------------------- opções

  /**
   * Tudo o que a tela de lançar precisa, numa ida só.
   *
   * Eram seis chamadas separadas no Supabase, disparadas em paralelo pelo
   * Server Component. Agora que o front está na Vercel e a API na VPS, cada
   * chamada é uma viagem de rede inteira — juntar as seis numa é a
   * diferença entre a tela abrir na hora e abrir depois de seis idas e
   * voltas no 4G da obra.
   */
  async opcoes() {
    const [obras, servicos, funcionarios, equipesCruas, categorias] = await Promise.all([
      // Sem valorContrato: é margem.
      this.obras.find({
        where: { status: 'em_andamento' },
        select: ['id', 'nome', 'cliente', 'bairro', 'cidade'],
        order: { nome: 'ASC' },
      }),
      // Sem valorVenda nem valorMaoObra: é margem.
      this.servicos.find({
        where: { ativo: true },
        select: ['id', 'nome', 'unidade'],
        order: { nome: 'ASC' },
      }),
      // Sem valorDiaria nem valorProducao: é o salário do colega.
      this.funcionarios.find({
        where: { ativo: true },
        select: ['id', 'nome', 'regime'],
        order: { nome: 'ASC' },
      }),
      this.equipes.find({
        where: { ativo: true },
        select: { id: true, nome: true },
        relations: { membros: { funcionario: true } },
        order: { nome: 'ASC' },
      }),
      this.categorias.find({
        where: { ativo: true },
        select: ['id', 'nome'],
        order: { nome: 'ASC' },
      }),
    ])

    const equipes = equipesCruas.map((e) => ({
      id: e.id,
      nome: e.nome,
      // Só os nomes: a tela mostra "Equipe A (João, Pedro)" para o operador
      // saber que está escolhendo a equipe certa. Nada além disso desce.
      membros: (e.membros ?? [])
        .map((m) => m.funcionario?.nome)
        .filter((n): n is string => Boolean(n))
        .sort((a, b) => a.localeCompare(b, 'pt-BR')),
    }))

    return { obras, servicos, funcionarios, equipes, categorias }
  }

  // --------------------------------------------------------- lançamentos

  async lancarProducao(dto: LancarProducaoDto, usuario: UsuarioDaSessao): Promise<{ id: string }> {
    this.recusarDataFutura(dto.data, 'produção')

    // Executor: um OU outro. O CHECK do banco também barra, mas ele diria
    // "chk_executor violated" — aqui a recusa sai em português.
    const id =
      dto.tipoExecutor === 'funcionario' ? dto.funcionarioId : dto.equipeId
    if (!id) {
      throw new ErroDeRegra(
        dto.tipoExecutor === 'funcionario'
          ? 'Escolha quem fez o serviço.'
          : 'Escolha a equipe que fez o serviço.',
      )
    }

    return this.dataSource.transaction(async (gerente) => {
      const servico = await gerente.findOne(Servico, {
        where: { id: dto.servicoId, ativo: true },
      })
      if (!servico) throw new ErroDeRegra('Serviço não encontrado ou inativo.')

      const obra = await gerente.findOne(Obra, { where: { id: dto.obraId } })
      if (!obra) throw new ErroDeRegra('Obra não encontrada.')
      if (obra.status !== 'em_andamento') {
        throw new ErroDeRegra(
          `A obra "${obra.nome}" está ${obra.status === 'concluida' ? 'concluída' : 'cancelada'}. Não dá para lançar nela.`,
        )
      }

      let funcionario: Funcionario | null = null
      if (dto.tipoExecutor === 'funcionario') {
        funcionario = await gerente.findOne(Funcionario, {
          where: { id: dto.funcionarioId!, ativo: true },
        })
        if (!funcionario) throw new ErroDeRegra('Funcionário não encontrado ou inativo.')
      } else {
        const equipe = await gerente.findOne(Equipe, {
          where: { id: dto.equipeId!, ativo: true },
        })
        if (!equipe) throw new ErroDeRegra('Equipe não encontrada ou inativa.')
      }

      // ---------------------------------------------- quanto vale a mão de obra
      //
      // Lançamento de EQUIPE usa o valor do serviço, e o rateio divide em
      // partes iguais: quem trabalha junto divide o mesmo bolo. O valor
      // combinado com cada pessoa vale quando ela lança sozinha.
      //
      // Sozinha, a busca desce do mais específico para o mais genérico:
      //
      //   1. o valor DESTA pessoa NESTE serviço
      //   2. o valor geral dela
      //   3. o valor do serviço
      //
      // A ordem importa porque o número mais específico é sempre o que
      // alguém combinou por último — e um genérico sobrepondo um combinado
      // paga errado sem ninguém perceber até o fechamento.
      let valorMaoObraUnit = servico.valorMaoObra

      if (funcionario?.regime === 'producao') {
        const doServico = await gerente.findOne(FuncionarioServico, {
          where: { funcionarioId: funcionario.id, servicoId: servico.id },
        })

        valorMaoObraUnit =
          doServico?.valor ?? funcionario.valorProducao ?? servico.valorMaoObra
      }

      const producaoId = randomUUID()

      await gerente.insert(Producao, {
        id: producaoId,
        data: dto.data,
        servicoId: servico.id,
        quantidade: dto.quantidade.toFixed(2),
        tipoExecutor: dto.tipoExecutor,
        funcionarioId: dto.tipoExecutor === 'funcionario' ? dto.funcionarioId! : null,
        equipeId: dto.tipoExecutor === 'equipe' ? dto.equipeId! : null,
        // Congelados: reajustar o serviço amanhã não reescreve o que
        // aconteceu hoje.
        unidade: servico.unidade,
        valorVendaUnit: servico.valorVenda,
        valorMaoObraUnit,
        obraId: obra.id,
        observacao: dto.observacao?.trim() || null,
        criadoPor: usuario.id,
      })

      // Dentro da mesma transação, sempre: no Postgres era um trigger e não
      // havia como esquecer. Aqui há — e uma produção sem rateio é uma
      // comissão que ninguém recebe e ninguém percebe até o fechamento.
      await this.rateio.recalcular(gerente, producaoId)

      return { id: producaoId }
    })
  }

  /**
   * O operador diz "fulano trabalhou hoje" e o valor vem do cadastro.
   * Ele nunca digita — nem vê — quanto o colega ganha por dia.
   */
  async lancarDiaria(dto: LancarDiariaDto, usuario: UsuarioDaSessao): Promise<{ id: string }> {
    this.recusarDataFutura(dto.data, 'diária')

    const funcionario = await this.funcionarios.findOne({
      where: { id: dto.funcionarioId, ativo: true },
    })
    if (!funcionario) throw new ErroDeRegra('Funcionário não encontrado ou inativo.')

    if (funcionario.regime !== 'diaria') {
      throw new ErroDeRegra(`${funcionario.nome} é pago por produção, não por diária.`)
    }
    if (funcionario.valorDiaria === null) {
      // O CHECK do banco impede este cadastro, então chegar aqui significa
      // que alguém escreveu direto no MySQL. Recusar é melhor que gravar
      // uma diária de valor zero que só aparece no fechamento.
      throw new ErroDeRegra(
        `O cadastro de ${funcionario.nome} está sem valor de diária. O administrador precisa corrigir.`,
      )
    }

    const id = randomUUID()
    await this.diarias.insert({
      id,
      funcionarioId: funcionario.id,
      data: dto.data,
      valor: funcionario.valorDiaria,
      observacao: dto.observacao?.trim() || null,
      pagamentoId: null,
      criadoPor: usuario.id,
    })

    return { id }
  }

  async lancarGasto(dto: LancarGastoDto, usuario: UsuarioDaSessao): Promise<{ id: string }> {
    this.recusarDataFutura(dto.data, 'gasto')

    const categoria = await this.categorias.findOne({
      where: { id: dto.categoriaId, ativo: true },
    })
    if (!categoria) throw new ErroDeRegra('Categoria de gasto não encontrada.')

    const obra = await this.obras.findOne({ where: { id: dto.obraId } })
    if (!obra) throw new ErroDeRegra('Obra não encontrada.')
    if (obra.status !== 'em_andamento') {
      throw new ErroDeRegra(
        `A obra "${obra.nome}" está ${obra.status === 'concluida' ? 'concluída' : 'cancelada'}. Não dá para lançar nela.`,
      )
    }

    const id = randomUUID()
    await this.dataSource.getRepository(Gasto).insert({
      id,
      data: dto.data,
      categoriaId: categoria.id,
      descricao: dto.descricao.trim(),
      valor: dto.valor.toFixed(2),
      obraId: obra.id,
      criadoPor: usuario.id,
    })

    return { id }
  }

  // --------------------------------------------------------- conferência

  /**
   * O que EU lancei nos últimos dias.
   *
   * SQL cru e não QueryBuilder: são três tabelas diferentes unidas num
   * histórico só, e o UNION ALL diz isso melhor do que três consultas
   * costuradas em JavaScript.
   *
   * Repare nos `NULL as valor` da produção e da diária. Não é campo
   * esquecido: é a regra do arquivo. O operador confere que lançou "12,5 m²
   * de reboco para o João" sem descobrir quanto o João vai receber por isso.
   * Só o gasto traz valor — porque o valor do gasto foi ele quem digitou.
   */
  async meus(dto: MeusLancamentosDto, usuario: UsuarioDaSessao) {
    const desde = diasAtras(dto.dias)

    return this.dataSource.query(
      `
      SELECT id, tipo, data, titulo, subtitulo, obra, valor, criadoEm FROM (
        SELECT p.id,
               'producao' AS tipo,
               p.data,
               CONCAT(
                 s.nome, ' — ',
                 FORMAT(p.quantidade, 2, 'de_DE'), ' ',
                 CASE p.unidade
                   WHEN 'm2'           THEN 'm²'
                   WHEN 'metro_linear' THEN 'm'
                   ELSE                     'un'
                 END
               ) AS titulo,
               COALESCE(f.nome, e.nome) AS subtitulo,
               o.nome AS obra,
               NULL AS valor,
               p.criadoEm
          FROM producoes p
          JOIN servicos s        ON s.id = p.servicoId
          JOIN obras o           ON o.id = p.obraId
          LEFT JOIN funcionarios f ON f.id = p.funcionarioId
          LEFT JOIN equipes e      ON e.id = p.equipeId
         WHERE p.criadoPor = ? AND p.data >= ?

        UNION ALL

        SELECT d.id, 'diaria', d.data, 'Diária', f.nome, NULL, NULL, d.criadoEm
          FROM diarias d
          JOIN funcionarios f ON f.id = d.funcionarioId
         WHERE d.criadoPor = ? AND d.data >= ?

        UNION ALL

        SELECT g.id, 'gasto', g.data, g.descricao, c.nome, o.nome, g.valor, g.criadoEm
          FROM gastos g
          JOIN categorias_gasto c ON c.id = g.categoriaId
          JOIN obras o            ON o.id = g.obraId
         WHERE g.criadoPor = ? AND g.data >= ?
      ) t
      ORDER BY t.data DESC, t.criadoEm DESC
      `,
      [usuario.id, desde, usuario.id, desde, usuario.id, desde],
    )
  }

  /**
   * Quantas diárias esse funcionário já tem nesta data.
   *
   * A tela usa para avisar sobre duplicata — sem bloquear, porque meia
   * diária e hora extra existem e são lançadas como uma segunda linha.
   */
  async diariasNoDia(dto: DiariasNoDiaDto): Promise<{ quantidade: number }> {
    const quantidade = await this.diarias.count({
      where: { funcionarioId: dto.funcionarioId, data: dto.data },
    })
    return { quantidade }
  }

  // -------------------------------------------------------------- apagar

  /**
   * Apagar um lançamento errado.
   *
   * O operador conserta o próprio erro do dia; fora disso, é com o admin.
   * As duas janelas — "foi você" e "faz menos de 24h" — existem para que
   * corrigir um dedo trocado não precise de telefonema, sem que isso abra a
   * porta para reescrever um mês fechado.
   *
   * Cada recusa diz o motivo. Um `DELETE ... WHERE criadoPor = ?` seria
   * mais curto e apagaria zero linhas em silêncio, deixando o operador
   * achando que deu certo.
   */
  async apagar(tipo: TipoLancamento, id: string, usuario: UsuarioDaSessao): Promise<void> {
    await this.dataSource.transaction(async (gerente) => {
      // Um switch e não um mapa de entidades indexado pelo tipo: o mapa
      // obriga a apagar os tipos com `as never` para o TypeORM aceitar, e
      // aí o compilador para de conferir os nomes das colunas — que é
      // justamente o que se quer dele aqui.
      const linha =
        tipo === 'producao'
          ? await gerente.findOne(Producao, { where: { id }, select: ['criadoPor', 'criadoEm'] })
          : tipo === 'diaria'
            ? await gerente.findOne(Diaria, { where: { id }, select: ['criadoPor', 'criadoEm'] })
            : await gerente.findOne(Gasto, { where: { id }, select: ['criadoPor', 'criadoEm'] })

      if (!linha) throw new NotFoundException({ erro: 'Lançamento não encontrado.' })

      if (usuario.papel !== 'admin') {
        if (linha.criadoPor !== usuario.id) {
          throw new ErroDeRegra(
            'Esse lançamento foi feito por outra pessoa. Peça ao administrador.',
          )
        }
        const horas = (Date.now() - linha.criadoEm.getTime()) / 3_600_000
        if (horas > 24) {
          throw new ErroDeRegra(
            'Lançamento com mais de 24h só o administrador pode apagar.',
          )
        }
      }

      if (tipo === 'producao') {
        const pago = await gerente
          .createQueryBuilder(ProducaoRateio, 'r')
          .where('r.producaoId = :id', { id })
          .andWhere('r.pagamentoId IS NOT NULL')
          .getExists()

        if (pago) {
          throw new ErroDeRegra('A comissão desse lançamento já foi paga — não dá para apagar.')
        }
        // O rateio vai junto pela FK (ON DELETE CASCADE).
        await gerente.delete(Producao, { id })
        return
      }

      if (tipo === 'diaria') {
        const diaria = await gerente.findOne(Diaria, { where: { id }, select: ['pagamentoId'] })
        if (diaria?.pagamentoId) {
          throw new ErroDeRegra('Essa diária já foi paga — não dá para apagar.')
        }
        await gerente.delete(Diaria, { id })
        return
      }

      await gerente.delete(Gasto, { id })
    })
  }

  // ------------------------------------------------------------ privados

  private recusarDataFutura(data: string, oQue: string): void {
    if (data > hoje()) {
      throw new ErroDeRegra(`Não dá para lançar ${oQue} com data futura.`)
    }
  }
}
