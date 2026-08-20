import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryColumn } from 'typeorm'

import { Funcionario } from './funcionario.entity'

@Entity('equipes')
export class Equipe {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string

  @Column({ type: 'varchar', length: 160 })
  nome!: string

  @Column({ type: 'boolean', default: true })
  ativo!: boolean

  @CreateDateColumn({ type: 'datetime', precision: 3 })
  criadoEm!: Date

  @OneToMany(() => EquipeMembro, (m) => m.equipe)
  membros!: EquipeMembro[]
}

@Entity('equipe_membros')
export class EquipeMembro {
  @PrimaryColumn({ type: 'char', length: 36 })
  equipeId!: string

  @PrimaryColumn({ type: 'char', length: 36 })
  funcionarioId!: string

  @ManyToOne(() => Equipe, (e) => e.membros, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'equipeId' })
  equipe!: Equipe

  @ManyToOne(() => Funcionario, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'funcionarioId' })
  funcionario!: Funcionario
}
