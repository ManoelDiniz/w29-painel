import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'

import { AuthModule } from './auth/auth.module'
import { CadastrosModule } from './cadastros/cadastros.module'
import { LancamentosModule } from './lancamentos/lancamentos.module'
import { UsuariosModule } from './usuarios/usuarios.module'
import { opcoesBanco } from './config/fonte-dados'
import { SaudeController } from './saude.controller'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(opcoesBanco),
    AuthModule,
    LancamentosModule,
    CadastrosModule,
    UsuariosModule,
  ],
  controllers: [SaudeController],
})
export class AppModule {}
