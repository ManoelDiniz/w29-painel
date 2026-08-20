import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { Usuario } from '../entidades'
import { UsuariosController } from './usuarios.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Usuario])],
  controllers: [UsuariosController],
})
export class UsuariosModule {}
