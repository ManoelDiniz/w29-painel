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
