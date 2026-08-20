import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm'

import { REGIMES, type Regime } from './tipos'

/**
 * Quem executa o serviço. Não é usuário do sistema — o pedreiro não
 * loga; o operador lança por ele.
 */
@Entity('funcionarios')
export class Funcionario {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string

  @Column({ type: 'varchar', length: 160 })
  nome!: string

  @Column({ type: 'enum', enum: REGIMES })
  regime!: Regime

  /**
   * Decimal volta como string do MySQL, e é assim que tem que ser: dinheiro
   * em `number` acumula erro de ponto flutuante (0.1 + 0.2 = 0.30000000000000004).
   * A conversão para número acontece só na hora da conta, em `dinheiro.ts`.
   *
   * Obrigatório para diarista, proibido para comissionado — o CHECK no
   * banco garante, e `CadastrosService` traduz a recusa.
   */
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  valorDiaria!: string | null

  /**
   * Preço de mão de obra próprio deste funcionário, que ganha do preço do
   * serviço quando existe. É como um comissionado negocia um valor melhor
   * sem virar exceção no cadastro do serviço.
   */
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  valorProducao!: string | null

  @Column({ type: 'boolean', default: true })
  ativo!: boolean

  @CreateDateColumn({ type: 'datetime', precision: 3 })
  criadoEm!: Date
}

/**
 * O que ESTA pessoa recebe NESTE serviço.
 *
 * Existe porque um valor único por funcionário não sobrevive à obra: o mesmo
 * pedreiro ganha um tanto no reboco e outro na pintura. Sem esta tabela, a
 * saída seria cadastrar a pessoa duas vezes — e aí o saldo dela fica
 * partido em dois nomes no fechamento.
 *
 * Vale só no lançamento individual. Em equipe, todos dividem o valor do
 * serviço em partes iguais.
 */
@Entity('funcionario_servicos')
export class FuncionarioServico {
  @PrimaryColumn({ type: 'char', length: 36 })
  funcionarioId!: string

  @PrimaryColumn({ type: 'char', length: 36 })
  servicoId!: string

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  valor!: string
}
