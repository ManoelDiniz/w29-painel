import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { randomUUID } from 'node:crypto'
import { DataSource, EntityManager, Repository } from 'typeorm'

import type { UsuarioDaSessao } from '../auth/decoradores'
import { ErroDeRegra } from '../comum/erros'
import { Equipe, EquipeMembro, Funcionario, FuncionarioServico, Obra, Servico } from '../entidades'
import type {
  SalvarEquipeDto,
  SalvarFuncionarioDto,
  SalvarObraDto,
  SalvarServicoDto,
} from './cadastros.dto'

/** Formata só para caber numa mensagem de erro. */
const emReais = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/**
 * Os cadastros que alimentam o lançamento. Tudo aqui é do admin — o
 * controller carrega @SoAdmin() na classe inteira.
 *
 * Note que quase nada é apagado, só desativado. Um funcionário apagado
 * levaria junto o histórico de produção dele (ou seria barrado pela FK, que
 * é o que acontece de fato). `ativo = false` tira da lista de lançamento e
 * mantém o passado de pé.
 */
@Injectable()
export class CadastrosService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Obra) private readonly obras: Repository<Obra>,
    @InjectRepository(Servico) private readonly servicos: Repository<Servico>,
    @InjectRepository(Funcionario) private readonly funcionarios: Repository<Funcionario>,
    @InjectRepository(Equipe) private readonly equipes: Repository<Equipe>,
  ) {}

  // -------------------------------------------------------------- painel

  /** Os contadores da tela inicial do admin — e o roteiro do que falta. */
  async painel() {
    const [obras, servicos, funcionarios, equipes] = await Promise.all([
      this.obras.count({ where: { status: 'em_andamento' } }),
      this.servicos.count({ where: { ativo: true } }),
      this.funcionarios.count({ where: { ativo: true } }),
      this.equipes.count({ where: { ativo: true } }),
    ])
    return { obras, servicos, funcionarios, equipes }
  }

  // --------------------------------------------------------------- obras

  listarObras(): Promise<Obra[]> {
    return this.obras.find({ order: { status: 'ASC', nome: 'ASC' } })
  }

  async criarObra(dto: SalvarObraDto, usuario: UsuarioDaSessao): Promise<Obra> {
    const obra = this.obras.create({
      ...this.camposDaObra(dto),
      id: randomUUID(),
      status: dto.status ?? 'em_andamento',
      criadoPor: usuario.id,
    })
    return this.obras.save(obra)
  }

  async atualizarObra(id: string, dto: SalvarObraDto): Promise<Obra> {
    const obra = await this.obras.findOne({ where: { id } })
    if (!obra) throw new NotFoundException({ erro: 'Obra não encontrada.' })

    Object.assign(obra, this.camposDaObra(dto))
    if (dto.status) obra.status = dto.status

    return this.obras.save(obra)
  }

  /**
   * `criadoPor` fica de fora de propósito: quem cadastrou a obra é um fato
   * do passado. Se ele entrasse aqui, uma edição feita por outro admin
   * reescreveria a autoria.
   */
  private camposDaObra(dto: SalvarObraDto) {
    return {
      nome: dto.nome,
      cliente: dto.cliente ?? null,
      cep: dto.cep ?? null,
      logradouro: dto.logradouro ?? null,
      numero: dto.numero ?? null,
      complemento: dto.complemento ?? null,
      bairro: dto.bairro ?? null,
      cidade: dto.cidade ?? null,
      uf: dto.uf ?? null,
      valorContrato: dto.valorContrato != null ? dto.valorContrato.toFixed(2) : null,
      prazo: dto.prazo ?? null,
      observacao: dto.observacao ?? null,
    }
  }

  // ------------------------------------------------------------ serviços

  listarServicos(): Promise<Servico[]> {
    return this.servicos.find({ order: { ativo: 'DESC', nome: 'ASC' } })
  }

  criarServico(dto: SalvarServicoDto): Promise<Servico> {
    this.conferirMargem(dto)
    return this.servicos.save(
      this.servicos.create({ id: randomUUID(), ...this.camposDoServico(dto) }),
    )
  }

  async atualizarServico(id: string, dto: SalvarServicoDto): Promise<Servico> {
    this.conferirMargem(dto)
    const servico = await this.servicos.findOne({ where: { id } })
    if (!servico) throw new NotFoundException({ erro: 'Serviço não encontrado.' })

    Object.assign(servico, this.camposDoServico(dto))
    return this.servicos.save(servico)
  }

  private camposDoServico(dto: SalvarServicoDto) {
    return {
      nome: dto.nome,
      unidade: dto.unidade,
      valorVenda: dto.valorVenda.toFixed(2),
      valorMaoObra: dto.valorMaoObra.toFixed(2),
      ativo: dto.ativo ?? true,
    }
  }

  /**
   * O CHECK do banco também barra isto. A checagem aqui existe pela
   * mensagem: "chk_margem is violated" não ajuda ninguém, e o erro quase
   * sempre é o mesmo — os dois campos foram preenchidos trocados.
   */
  private conferirMargem(dto: SalvarServicoDto): void {
    if (dto.valorMaoObra > dto.valorVenda) {
      throw new ErroDeRegra(
        `Você pagaria ${emReais(dto.valorMaoObra)} e cobraria só ${emReais(dto.valorVenda)}. ` +
          'Confira: os campos podem estar trocados.',
      )
    }
  }

  // --------------------------------------------------------- funcionários

  /**
   * Os funcionários, cada um com o que recebe em cada serviço.
   *
   * Duas consultas e uma junção em memória, e não um LEFT JOIN: com o join,
   * uma pessoa com dez serviços vira dez linhas repetidas que eu teria de
   * desdobrar de qualquer jeito. São dois SELECTs numa tabela que tem
   * dezenas de linhas, não milhões.
   */
  async listarFuncionarios() {
    const [funcionarios, valores] = await Promise.all([
      this.funcionarios.find({ order: { ativo: 'DESC', nome: 'ASC' } }),
      this.dataSource.getRepository(FuncionarioServico).find(),
    ])

    const porFuncionario = new Map<string, { servicoId: string; valor: string }[]>()
    for (const v of valores) {
      const lista = porFuncionario.get(v.funcionarioId) ?? []
      lista.push({ servicoId: v.servicoId, valor: v.valor })
      porFuncionario.set(v.funcionarioId, lista)
    }

    return funcionarios.map((f) => ({
      ...f,
      valoresPorServico: porFuncionario.get(f.id) ?? [],
    }))
  }

  async criarFuncionario(dto: SalvarFuncionarioDto): Promise<Funcionario> {
    const id = randomUUID()

    return this.dataSource.transaction(async (gerente) => {
      const funcionario = await gerente
        .getRepository(Funcionario)
        .save(gerente.getRepository(Funcionario).create({ id, ...this.camposDoFuncionario(dto) }))

      await this.gravarValoresPorServico(gerente, id, dto)
      return funcionario
    })
  }

  async atualizarFuncionario(id: string, dto: SalvarFuncionarioDto): Promise<Funcionario> {
    return this.dataSource.transaction(async (gerente) => {
      const repo = gerente.getRepository(Funcionario)

      const funcionario = await repo.findOne({ where: { id } })
      if (!funcionario) throw new NotFoundException({ erro: 'Funcionário não encontrado.' })

      Object.assign(funcionario, this.camposDoFuncionario(dto))
      const salvo = await repo.save(funcionario)

      await this.gravarValoresPorServico(gerente, id, dto)
      return salvo
    })
  }

  /**
   * Reescreve a tabela de preços da pessoa.
   *
   * Apaga e refaz, como os membros de equipe: mandar a lista sem um serviço
   * significa "não tenho valor próprio nele", e um UPDATE deixaria o preço
   * antigo de pé — a pessoa continuaria recebendo um valor que o admin
   * acabou de tirar da tela.
   *
   * Isso NÃO mexe em produção já lançada: o valor foi congelado na linha do
   * lançamento no dia em que aconteceu. Mudar o preço hoje vale de hoje em
   * diante, e é justamente por isso que o congelamento existe.
   */
  private async gravarValoresPorServico(
    gerente: EntityManager,
    funcionarioId: string,
    dto: SalvarFuncionarioDto,
  ): Promise<void> {
    // O campo ausente significa "não mexi nisso" — comum quando outra tela
    // salva o funcionário sem conhecer a lista de preços. Apagar aqui seria
    // destruir dado que ninguém pediu para destruir.
    if (dto.valoresPorServico === undefined) return

    const repo = gerente.getRepository(FuncionarioServico)
    await repo.delete({ funcionarioId })

    // Diarista não tem preço por serviço: o custo dele é a diária. Deixar
    // linhas aqui seria dinheiro parado esperando alguém trocar o regime e
    // se surpreender.
    if (dto.regime !== 'producao') return

    // Duplicata no mesmo serviço quebraria a PK com um erro obscuro; fica o
    // último, que é o que a tela mostrava quando o admin clicou em salvar.
    const porServico = new Map<string, number>()
    for (const v of dto.valoresPorServico) porServico.set(v.servicoId, v.valor)

    if (porServico.size === 0) return

    const ids = [...porServico.keys()]
    const existentes = await gerente.getRepository(Servico).findBy(ids.map((id) => ({ id })))
    if (existentes.length !== ids.length) {
      throw new ErroDeRegra(
        'Um dos serviços escolhidos não existe mais. Recarregue a página e tente de novo.',
      )
    }

    await repo.insert(
      ids.map((servicoId) => ({
        funcionarioId,
        servicoId,
        valor: porServico.get(servicoId)!.toFixed(2),
      })),
    )
  }

  /**
   * Cada regime carrega só o valor que lhe pertence.
   *
   * Zerar o outro não é limpeza cosmética: trocar um diarista para produção
   * sem apagar a diária deixaria um valor órfão que o CHECK do banco recusa
   * — e o admin veria uma recusa sobre um campo que a tela nem mostra mais.
   */
  private camposDoFuncionario(dto: SalvarFuncionarioDto) {
    if (dto.regime === 'diaria' && (dto.valorDiaria == null || dto.valorDiaria <= 0)) {
      throw new ErroDeRegra(
        'Diarista precisa do valor da diária. Use números, como 120,00.',
      )
    }

    return {
      nome: dto.nome,
      regime: dto.regime,
      valorDiaria: dto.regime === 'diaria' ? dto.valorDiaria!.toFixed(2) : null,
      valorProducao:
        dto.regime === 'producao' && dto.valorProducao != null
          ? dto.valorProducao.toFixed(2)
          : null,
      ativo: dto.ativo ?? true,
    }
  }

  // -------------------------------------------------------------- equipes

  async listarEquipes() {
    const equipes = await this.equipes.find({
      relations: { membros: { funcionario: true } },
      order: { ativo: 'DESC', nome: 'ASC' },
    })

    return equipes.map((e) => ({
      id: e.id,
      nome: e.nome,
      ativo: e.ativo,
      membros: (e.membros ?? [])
        .map((m) => m.funcionario)
        .filter(Boolean)
        .map((f) => ({ id: f.id, nome: f.nome, regime: f.regime }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    }))
  }

  criarEquipe(dto: SalvarEquipeDto) {
    return this.salvarEquipe(randomUUID(), dto, true)
  }

  atualizarEquipe(id: string, dto: SalvarEquipeDto) {
    return this.salvarEquipe(id, dto, false)
  }

  /**
   * A lista de membros é reescrita inteira a cada gravação.
   *
   * Isso NÃO mexe em produção já lançada: o rateio de um lançamento antigo
   * foi gravado no momento em que aconteceu, e trocar a equipe hoje não
   * refaz a divisão de ontem. É a mesma ideia do preço congelado — o
   * passado é fato, não consulta ao cadastro atual.
   */
  private async salvarEquipe(id: string, dto: SalvarEquipeDto, nova: boolean) {
    return this.dataSource.transaction(async (gerente) => {
      const repo = gerente.getRepository(Equipe)

      if (nova) {
        await repo.insert({ id, nome: dto.nome, ativo: dto.ativo ?? true })
      } else {
        const existe = await repo.findOne({ where: { id }, select: ['id'] })
        if (!existe) throw new NotFoundException({ erro: 'Equipe não encontrada.' })
        await repo.update({ id }, { nome: dto.nome, ativo: dto.ativo ?? true })
      }

      // Duplicata na lista quebraria a PK composta com um erro obscuro; e
      // um membro repetido dobraria a fatia dele no rateio.
      const membros = [...new Set(dto.membros)]

      const existentes = await gerente.getRepository(Funcionario).findBy(
        membros.map((funcionarioId) => ({ id: funcionarioId })),
      )
      if (existentes.length !== membros.length) {
        throw new ErroDeRegra(
          'Um dos funcionários escolhidos não existe mais. Recarregue a página e tente de novo.',
        )
      }

      const repoMembros = gerente.getRepository(EquipeMembro)
      await repoMembros.delete({ equipeId: id })
      await repoMembros.insert(
        membros.map((funcionarioId) => ({ equipeId: id, funcionarioId })),
      )

      return { id }
    })
  }
}
