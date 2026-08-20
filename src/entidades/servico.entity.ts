import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm'

import { UNIDADES, type Unidade } from './tipos'

/**
 * Todo serviço tem DOIS preços: o que o cliente paga e o que o funcionário
 * recebe. A margem é a diferença — derivada, nunca digitada, para não
 * existir a chance de os três números discordarem entre si.
 */
@Entity('servicos')
export class Servico {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string

  @Column({ type: 'varchar', length: 160 })
  nome!: string

  @Column({ type: 'enum', enum: UNIDADES })
  unidade!: Unidade

  /** O que o cliente paga. O operador NUNCA recebe este número. */
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  valorVenda!: string

  /** O que o executor recebe. */
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  valorMaoObra!: string

  @Column({ type: 'boolean', default: true })
  ativo!: boolean

  @CreateDateColumn({ type: 'datetime', precision: 3 })
  criadoEm!: Date
}
