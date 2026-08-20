import 'reflect-metadata'
import { config as carregarEnv } from 'dotenv'
import { DataSource, type DataSourceOptions } from 'typeorm'

import { env } from './env'
import { TODAS_ENTIDADES } from '../entidades/lista'

// A CLI do TypeORM roda fora do Nest, então ninguém carregou o .env por ela.
carregarEnv()

/**
 * `synchronize` fica desligado de propósito, e não por precaução exagerada:
 * ligado, o TypeORM compara as entidades com o banco e "conserta" a
 * diferença sozinho na partida — o que em produção significa DROP de coluna
 * sem aviso. Schema aqui muda por migration, que é revisável e reversível.
 */
export const opcoesBanco: DataSourceOptions = {
  type: 'mysql',
  host: env.db.host,
  port: env.db.porta,
  username: env.db.usuario,
  password: env.db.senha,
  database: env.db.nome,

  entities: TODAS_ENTIDADES,
  migrations: [__dirname + '/../migrations/*.{ts,js}'],

  synchronize: false,
  migrationsRun: false,
  logging: env.producao ? ['error', 'warn'] : ['error', 'warn', 'schema'],

  // O MySQL guarda DATETIME sem fuso. Fixar UTC na conexão evita o clássico
  // "o lançamento de ontem à noite apareceu como hoje" quando a VPS está
  // num fuso e o servidor MySQL noutro.
  timezone: 'Z',

  // DATE volta como string 'YYYY-MM-DD' em vez de virar um Date no fuso do
  // processo. Data de lançamento é um dia do calendário, não um instante:
  // convertê-la para Date é o que faz 2026-03-01 virar 2026-02-28 às 21h.
  dateStrings: ['DATE'],
}

export const fonteDados = new DataSource(opcoesBanco)
