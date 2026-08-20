import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { Diaria, Funcionario, Pagamento, ProducaoRateio } from '../entidades'
import { PagamentosController } from './pagamentos.controller'
import { PagamentosService } from './pagamentos.service'

@Module({
  imports: [TypeOrmModule.forFeature([Pagamento, ProducaoRateio, Diaria, Funcionario])],
  controllers: [PagamentosController],
  providers: [PagamentosService],
})
export class PagamentosModule {}
