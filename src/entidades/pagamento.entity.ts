import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm'

import { Funcionario } from './funcionario.entity'

/**
 * Fechamento: um pagamento quita as comissões e diárias de um funcionário
 * até uma data. Quitar é carimbar `pagamentoId` nas linhas de rateio e
 * diária — o que também as torna imutáveis daí em diante.
 */
@Entity('pagamentos')
export class Pagamento {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string

  @Column({ type: 'char', length: 36 })
  funcionarioId!: string

  @ManyToOne(() => Funcionario, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'funcionarioId' })
  funcionario!: Funcionario

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  valorTotal!: string

  @Column({ type: 'date' })
  referenciaAte!: string

  @Column({ type: 'text', nullable: true })
  observacao!: string | null

  @CreateDateColumn({ type: 'datetime', precision: 3 })
  pagoEm!: Date

  @Column({ type: 'char', length: 36 })
  criadoPor!: string
}
