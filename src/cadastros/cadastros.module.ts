import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { Equipe, EquipeMembro, Funcionario, FuncionarioServico, Obra, Servico } from '../entidades'
import { CadastrosController } from './cadastros.controller'
import { CadastrosService } from './cadastros.service'

@Module({
  imports: [TypeOrmModule.forFeature([Obra, Servico, Funcionario, FuncionarioServico, Equipe, EquipeMembro])],
  controllers: [CadastrosController],
  providers: [CadastrosService],
})
export class CadastrosModule {}
