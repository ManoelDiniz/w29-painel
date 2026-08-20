import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryColumn } from 'typeorm'

import { Equipe } from './equipe.entity'
import { Funcionario } from './funcionario.entity'
import { Obra } from './obra.entity'
import { Servico } from './servico.entity'
import { TIPOS_EXECUTOR, UNIDADES, type TipoExecutor, type Unidade } from './tipos'

/**
 * Um serviço executado: tanto de m², por fulano ou pela equipe tal, na obra
 * tal, no dia tal.
 *
 * Os preços são CONGELADOS aqui no momento do lançamento. Reajustar o preço
 * de um serviço amanhã não pode reescrever o que já foi feito ontem — senão
 * a comissão de um mês fechado muda sozinha.
 */
@Entity('producoes')
export class Producao {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string

  @Column({ type: 'date' })
  data!: string

  @Column({ type: 'char', length: 36 })
  servicoId!: string

  @ManyToOne(() => Servico, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'servicoId' })
  servico!: Servico

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  quantidade!: string

  @Column({ type: 'enum', enum: TIPOS_EXECUTOR })
  tipoExecutor!: TipoExecutor

  @Column({ type: 'char', length: 36, nullable: true })
  funcionarioId!: string | null

  @ManyToOne(() => Funcionario, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'funcionarioId' })
  funcionario!: Funcionario | null

  @Column({ type: 'char', length: 36, nullable: true })
  equipeId!: string | null

  @ManyToOne(() => Equipe, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'equipeId' })
  equipe!: Equipe | null

  // ------------------------------------------------- preços congelados
  @Column({ type: 'enum', enum: UNIDADES })
  unidade!: Unidade

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  valorVendaUnit!: string

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  valorMaoObraUnit!: string

  /**
   * Colunas geradas pelo MySQL (`GENERATED ALWAYS AS ... STORED`), não pela
   * aplicação. Total calculado em código pode divergir do que está gravado
   * se alguém atualizar a quantidade por fora; gerado pelo banco, não pode.
   *
   * `insert:false, update:false` avisa o TypeORM para nunca tentar escrever
   * nelas — o MySQL recusa a escrita, e o erro seria confuso.
   */
  @Column({ type: 'decimal', precision: 14, scale: 2, insert: false, update: false })
  valorVendaTotal!: string

  /** O bolo de mão de obra que o rateio vai dividir. */
  @Column({ type: 'decimal', precision: 14, scale: 2, insert: false, update: false })
  poolMaoObra!: string

  @Column({ type: 'char', length: 36 })
  obraId!: string

  @ManyToOne(() => Obra, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'obraId' })
  obra!: Obra

  @Column({ type: 'text', nullable: true })
  observacao!: string | null

  @Column({ type: 'char', length: 36 })
  criadoPor!: string

  @CreateDateColumn({ type: 'datetime', precision: 3 })
  criadoEm!: Date

  @OneToMany(() => ProducaoRateio, (r) => r.producao)
  rateios!: ProducaoRateio[]
}

/**
 * Quanto cada funcionário ganhou em cada lançamento.
 *
 * No Postgres isto era escrito por trigger. Aqui quem escreve é o
 * `RateioService`, sempre dentro da mesma transação do lançamento —
 * nunca à mão, nunca por um controller. É a única fonte da verdade da
 * comissão: os relatórios somam esta tabela, e não quantidade × preço.
 */
@Entity('producao_rateios')
export class ProducaoRateio {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string

  @Column({ type: 'char', length: 36 })
  producaoId!: string

  @ManyToOne(() => Producao, (p) => p.rateios, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'producaoId' })
  producao!: Producao

  @Column({ type: 'char', length: 36 })
  funcionarioId!: string

  @ManyToOne(() => Funcionario, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'funcionarioId' })
  funcionario!: Funcionario

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  valor!: string

  /** Nulo = ainda devido. Preenchido = já entrou num fechamento. */
  @Column({ type: 'char', length: 36, nullable: true })
  pagamentoId!: string | null
}
