import { CategoriaGasto, Gasto } from './gasto.entity'
import { Diaria } from './diaria.entity'
import { Equipe, EquipeMembro } from './equipe.entity'
import { Funcionario } from './funcionario.entity'
import { Obra } from './obra.entity'
import { Pagamento } from './pagamento.entity'
import { Producao, ProducaoRateio } from './producao.entity'
import { Servico } from './servico.entity'
import { Usuario } from './usuario.entity'

/**
 * A lista que o TypeORM recebe.
 *
 * Escrita à mão, e não derivada do barrel com `Object.values`: o barrel
 * exporta também os enums (PAPEIS, UNIDADES...), que não são entidades. A
 * versão automática precisaria filtrar por "é função?" — o que engole em
 * silêncio a entidade nova que alguém esquecer de exportar. Aqui, esquecer
 * de incluir dá erro na primeira consulta.
 */
export const TODAS_ENTIDADES = [
  Usuario,
  Funcionario,
  Equipe,
  EquipeMembro,
  Servico,
  Obra,
  Pagamento,
  Producao,
  ProducaoRateio,
  Diaria,
  CategoriaGasto,
  Gasto,
]
