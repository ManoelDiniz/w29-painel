import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm'

import { Obra } from './obra.entity'

@Entity('categorias_gasto')
export class CategoriaGasto {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string

  @Column({ type: 'varchar', length: 120, unique: true })
  nome!: string

  @Column({ type: 'boolean', default: true })
  ativo!: boolean
}

/**
 * Dinheiro que saiu: material, combustível, ferramenta.
 *
 * Diferente de produção e diária, o valor aqui é o que o próprio operador
 * digitou — não há margem escondida. Por isso ele pode reler os gastos que
 * lançou, o que não pode fazer com as outras duas tabelas.
 */
@Entity('gastos')
export class Gasto {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string

  @Column({ type: 'date' })
  data!: string

  @Column({ type: 'char', length: 36 })
  categoriaId!: string

  @ManyToOne(() => CategoriaGasto, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'categoriaId' })
  categoria!: CategoriaGasto

  @Column({ type: 'varchar', length: 300 })
  descricao!: string

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  valor!: string

  @Column({ type: 'char', length: 36 })
  obraId!: string

  @ManyToOne(() => Obra, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'obraId' })
  obra!: Obra

  @Column({ type: 'char', length: 36 })
  criadoPor!: string

  @CreateDateColumn({ type: 'datetime', precision: 3 })
  criadoEm!: Date
}
