import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { Equipe, EquipeMembro, Funcionario, Obra, Servico } from '../entidades'
import { CadastrosController } from './cadastros.controller'
import { CadastrosService } from './cadastros.service'

@Module({
  imports: [TypeOrmModule.forFeature([Obra, Servico, Funcionario, Equipe, EquipeMembro])],
  controllers: [CadastrosController],
  providers: [CadastrosService],
})
export class CadastrosModule {}
