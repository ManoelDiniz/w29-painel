import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import {
  CategoriaGasto,
  Diaria,
  Equipe,
  EquipeMembro,
  Funcionario,
  Gasto,
  Obra,
  Producao,
  ProducaoRateio,
  Servico,
} from '../entidades'
import { LancamentosController } from './lancamentos.controller'
import { LancamentosService } from './lancamentos.service'
import { RateioService } from './rateio.service'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Obra,
      Servico,
      Funcionario,
      Equipe,
      EquipeMembro,
      CategoriaGasto,
      Producao,
      ProducaoRateio,
      Diaria,
      Gasto,
    ]),
  ],
  controllers: [LancamentosController],
  providers: [LancamentosService, RateioService],
  // O RateioService sai daqui porque quem edita produção também precisa
  // recalcular — e refazer essa conta noutro lugar é como as duas versões
  // começam a discordar.
  exports: [RateioService],
})
export class LancamentosModule {}
