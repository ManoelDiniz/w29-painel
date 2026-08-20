import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm'

import { Funcionario } from './funcionario.entity'

/**
 * Um dia trabalhado por quem é pago por diária.
 *
 * Não tem obra: o diarista pode passar a manhã numa e a tarde noutra, e
 * inventar um rateio de tempo seria fingir uma precisão que ninguém mediu.
 *
 * Também não tem unique (funcionario, data) — meia diária e hora extra
 * existem. A tela avisa que já há lançamento no dia, mas não bloqueia.
 */
@Entity('diarias')
export class Diaria {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string

  @Column({ type: 'char', length: 36 })
  funcionarioId!: string

  @ManyToOne(() => Funcionario, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'funcionarioId' })
  funcionario!: Funcionario

  @Column({ type: 'date' })
  data!: string

  /** Congelado do cadastro no dia do lançamento. */
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  valor!: string

  @Column({ type: 'text', nullable: true })
  observacao!: string | null

  @Column({ type: 'char', length: 36, nullable: true })
  pagamentoId!: string | null

  @Column({ type: 'char', length: 36 })
  criadoPor!: string

  @CreateDateColumn({ type: 'datetime', precision: 3 })
  criadoEm!: Date
}
