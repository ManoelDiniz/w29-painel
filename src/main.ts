// Primeiro de todos os imports, e isso importa: `env.ts` e as opções do
// TypeORM leem process.env no momento em que são carregados. Se o .env
// entrasse depois, a API subiria com o banco em branco.
import 'dotenv/config'
import 'reflect-metadata'

import { Logger, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'

import { AppModule } from './app.module'
import { FiltroDeErros } from './comum/erros'
import { env } from './config/env'

async function iniciar(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: true })

  app.use(helmet())
  app.use(cookieParser())

  /**
   * CORS com credenciais e lista fechada de origens.
   *
   * `credentials: true` é o que permite ao navegador mandar o cookie de
   * sessão para outro domínio — e é justamente por isso que a origem não
   * pode ser '*': o navegador recusa a combinação, e mesmo que aceitasse,
   * qualquer site do mundo poderia fazer requisições autenticadas em nome
   * de quem estivesse logado.
   */
  app.enableCors({
    origin: (origem: string | undefined, callback: (erro: Error | null, permitir?: boolean) => void) => {
      // Sem Origin é chamada que não veio de navegador (curl, health check
      // do systemd, o próprio Nginx). Não há cookie de terceiro em jogo.
      if (!origem) return callback(null, true)

      if (env.origens.includes(origem.replace(/\/$/, ''))) return callback(null, true)

      // A mensagem some no console do navegador como "CORS error", então
      // ela precisa existir aqui no log da API — é o único lugar onde dá
      // para descobrir QUAL origem foi recusada.
      new Logger('CORS').warn(`Origem recusada: ${origem}`)
      return callback(null, false)
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })

  app.setGlobalPrefix('api')

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      // Campo que não está no DTO é descartado em vez de ir para o banco.
      // Sem isto, um POST com "papel":"admin" no corpo chegaria ao repositório.
      whitelist: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  )

  app.useGlobalFilters(new FiltroDeErros())

  // Fecha as conexões do MySQL no SIGTERM em vez de morrer com elas abertas.
  app.enableShutdownHooks()

  await app.listen(env.porta, '127.0.0.1')

  new Logger('W29').log(
    `API no ar em http://127.0.0.1:${env.porta}/api — origens liberadas: ${env.origens.join(', ')}`,
  )
}

void iniciar()
