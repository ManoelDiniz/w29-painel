import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm'

import { STATUS_OBRA, type StatusObra } from './tipos'

/**
 * Obra é cadastro, não texto solto no lançamento — senão "Casa do Centro"
 * e "casa centro" viram duas obras no relatório.
 *
 * O endereço fica em campos separados (e não numa linha só) porque é isso
 * que permite depois filtrar por bairro ou cidade.
 */
@Entity('obras')
export class Obra {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string

  @Column({ type: 'varchar', length: 160 })
  nome!: string

  @Column({ type: 'varchar', length: 160, nullable: true })
  cliente!: string | null

  /** Só os 8 dígitos, sem hífen. A tela formata; o banco guarda cru. */
  @Column({ type: 'char', length: 8, nullable: true })
  cep!: string | null

  @Column({ type: 'varchar', length: 200, nullable: true })
  logradouro!: string | null

  @Column({ type: 'varchar', length: 20, nullable: true })
  numero!: string | null

  @Column({ type: 'varchar', length: 120, nullable: true })
  complemento!: string | null

  @Column({ type: 'varchar', length: 120, nullable: true })
  bairro!: string | null

  @Column({ type: 'varchar', length: 120, nullable: true })
  cidade!: string | null

  @Column({ type: 'char', length: 2, nullable: true })
  uf!: string | null

  /** Quanto a obra foi vendida. É margem: o operador não vê. */
  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true })
  valorContrato!: string | null

  @Column({ type: 'date', nullable: true })
  prazo!: string | null

  @Column({ type: 'enum', enum: STATUS_OBRA, default: 'em_andamento' })
  status!: StatusObra

  @Column({ type: 'text', nullable: true })
  observacao!: string | null

  @Column({ type: 'char', length: 36 })
  criadoPor!: string

  @CreateDateColumn({ type: 'datetime', precision: 3 })
  criadoEm!: Date
}
