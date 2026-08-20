import { Global, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { JwtModule } from '@nestjs/jwt'
import { TypeOrmModule } from '@nestjs/typeorm'

import { paraSegundos } from '../comum/duracao'
import { env } from '../config/env'
import { Usuario } from '../entidades'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { SessaoGuard } from './sessao.guard'

/**
 * Global porque o guard registrado em APP_GUARD roda em todo módulo, e
 * precisa do JwtService e do repositório de usuários em todos eles.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Usuario]),
    JwtModule.register({
      global: true,
      secret: env.jwt.segredo,
      // Em segundos, e não '7d': é a mesma conta que o cookie usa, então os
      // dois vencem no mesmo instante em vez de cada um com o seu número.
      signOptions: { expiresIn: paraSegundos(env.jwt.validade) },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    // APP_GUARD e não @UseGuards nos controllers: assim o padrão é fechado.
    // Uma rota nova nasce protegida e só abre com @Publico() escrito nela.
    { provide: APP_GUARD, useClass: SessaoGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
