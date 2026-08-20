import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { AuthService } from '../auth/auth.service'
import { CriarUsuarioDto } from '../auth/auth.dto'
import { SoAdmin, UsuarioAtual, type UsuarioDaSessao } from '../auth/decoradores'
import { DefinirAtivoDto } from '../cadastros/cadastros.dto'
import { ErroDeRegra } from '../comum/erros'
import { Usuario } from '../entidades'

/** Quem entra no sistema. Só o admin mexe. */
@SoAdmin()
@Controller('usuarios')
export class UsuariosController {
  constructor(
    @InjectRepository(Usuario) private readonly usuarios: Repository<Usuario>,
    private readonly auth: AuthService,
  ) {}

  /**
   * O `select` explícito importa mais do que parece: sem ele o TypeORM
   * traria a entidade inteira, e o dia em que alguém apagar o
   * `select: false` do senhaHash, esta rota passa a publicar o hash de
   * senha de todo mundo num JSON. Listar coluna por coluna não depende
   * de a outra proteção continuar lá.
   */
  @Get()
  listar() {
    return this.usuarios.find({
      select: ['id', 'nome', 'email', 'papel', 'ativo', 'criadoEm'],
      order: { papel: 'ASC', nome: 'ASC' },
    })
  }

  /**
   * Cria um usuário — operador ou administrador, à escolha de quem chama.
   *
   * A escolha do cargo é segura aqui porque a classe inteira é @SoAdmin():
   * quem chega nesta rota já é administrador. O que continua proibido é o
   * cadastro PÚBLICO escolher cargo, e isso é garantido lá, por um DTO que
   * simplesmente não tem o campo.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  criar(@Body() dto: CriarUsuarioDto) {
    return this.auth.criarUsuario(dto)
  }

  /**
   * Liga e desliga o acesso.
   *
   * `ativo = false` é o desligamento: o login continua existindo, mas o
   * guard recusa na porta. É como se tira o acesso de alguém sem apagar o
   * histórico de lançamentos dessa pessoa.
   */
  @Patch(':id/ativo')
  async definirAtivo(
    @Param('id') id: string,
    @Body() dto: DefinirAtivoDto,
    @UsuarioAtual() usuario: UsuarioDaSessao,
  ) {
    // Desativar a própria conta é se trancar do lado de fora — e se este
    // for o único admin, ninguém consegue destrancar sem ir ao MySQL.
    if (id === usuario.id && !dto.ativo) {
      throw new ErroDeRegra('Você não pode desativar a própria conta.')
    }

    const alvo = await this.usuarios.findOne({ where: { id }, select: ['id'] })
    if (!alvo) throw new ErroDeRegra('Usuário não encontrado.')

    await this.usuarios.update({ id }, { ativo: dto.ativo })
    return { id, ativo: dto.ativo }
  }
}
