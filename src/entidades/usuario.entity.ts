import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm'

import { PAPEIS, type Papel } from './tipos'

/**
 * Quem entra no sistema.
 *
 * No Supabase isto era duas tabelas: `auth.users` (e-mail e senha, do
 * GoTrue) e `perfis` (nome, papel, ativo). Com o Nest dono da autenticação
 * não há mais dois donos — é uma tabela só.
 */
@Entity('usuarios')
export class Usuario {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string

  @Column({ type: 'varchar', length: 160 })
  nome!: string

  // Guardado sempre em minúsculas: senão "Joao@x.com" e "joao@x.com"
  // viram duas contas, e o unique não percebe.
  @Column({ type: 'varchar', length: 190, unique: true })
  email!: string

  /**
   * Hash bcrypt. Nunca sai daqui: `select` false faz o TypeORM omitir a
   * coluna em toda consulta que não peça por ela explicitamente, então
   * um `find()` distraído não consegue vazar o hash num JSON de resposta.
   */
  @Column({ type: 'varchar', length: 100, select: false })
  senhaHash!: string

  @Column({ type: 'enum', enum: PAPEIS, default: 'operador' })
  papel!: Papel

  /**
   * Desligamento sem apagar histórico: o login continua existindo, mas o
   * guard recusa. Apagar o usuário levaria junto os lançamentos dele.
   */
  @Column({ type: 'boolean', default: true })
  ativo!: boolean

  @CreateDateColumn({ type: 'datetime', precision: 3 })
  criadoEm!: Date
}
