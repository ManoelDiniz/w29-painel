import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { InjectRepository } from '@nestjs/typeorm'
import * as bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { DataSource, Repository } from 'typeorm'

import { ErroDeRegra } from '../comum/erros'
import { Usuario } from '../entidades'
import type { UsuarioDaSessao } from './decoradores'
import type { CadastrarDto, CriarUsuarioDto, EntrarDto } from './auth.dto'
import type { Conteudo } from './sessao.guard'

/**
 * Custo do bcrypt. 12 leva uns 250ms num núcleo modesto de VPS — devagar
 * o bastante para tornar um ataque de dicionário caro, rápido o bastante
 * para ninguém reclamar da tela de login.
 */
const CUSTO_HASH = 12

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Usuario) private readonly usuarios: Repository<Usuario>,
    private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Entrar.
   *
   * A mensagem de erro é a mesma para e-mail inexistente e senha errada, de
   * propósito: dizer "esse e-mail não existe" transforma a tela de login
   * numa lista de quem trabalha aqui.
   */
  async entrar(dto: EntrarDto): Promise<{ usuario: UsuarioDaSessao; token: string }> {
    const usuario = await this.usuarios.findOne({
      where: { email: dto.email },
      select: ['id', 'nome', 'email', 'papel', 'ativo', 'senhaHash'],
    })

    // Compara mesmo quando o usuário não existe, contra um hash descartável.
    // Sem isso, o "não achei" responde em 1ms e o "senha errada" em 250ms —
    // e essa diferença de tempo revela quais e-mails têm conta.
    const hash = usuario?.senhaHash ?? '$2a$12$invalidoinvalidoinvalidoinvalidoinvalidoinvalidoinvalidoinv'
    const confere = await bcrypt.compare(dto.senha, hash)

    if (!usuario || !confere) {
      throw new UnauthorizedException({ erro: 'E-mail ou senha errados.' })
    }

    if (!usuario.ativo) {
      throw new UnauthorizedException({
        erro: 'Sua conta não está mais ativa. Fale com o administrador.',
      })
    }

    return { usuario: this.paraSessao(usuario), token: await this.assinar(usuario) }
  }

  /**
   * Criar conta.
   *
   * O papel NÃO vem do formulário: qualquer um poderia se cadastrar pedindo
   * 'admin'. O primeiro usuário do sistema vira admin (é quem instalou), e
   * daí em diante todo mundo entra como operador. No Postgres isso era um
   * trigger em auth.users; aqui é esta transação.
   */
  async cadastrar(dto: CadastrarDto): Promise<{ usuario: UsuarioDaSessao; token: string }> {
    const criado = await this.dataSource.transaction(async (gerente) => {
      const repo = gerente.getRepository(Usuario)

      // FOR UPDATE numa tabela vazia trava a lacuna no InnoDB, então dois
      // cadastros simultâneos numa instalação nova não viram dois admins.
      const existentes = await gerente.query('SELECT id FROM usuarios LIMIT 1 FOR UPDATE')
      const primeiro = existentes.length === 0

      const usuario = repo.create({
        id: randomUUID(),
        nome: dto.nome,
        email: dto.email,
        senhaHash: await bcrypt.hash(dto.senha, CUSTO_HASH),
        papel: primeiro ? 'admin' : 'operador',
        ativo: true,
      })

      return repo.save(usuario)
    })

    return { usuario: this.paraSessao(criado), token: await this.assinar(criado) }
  }

  /**
   * O admin cria alguém — operador ou outro administrador.
   *
   * O papel vem do formulário AQUI, e só aqui. No cadastro público ele não
   * existe: qualquer um se inscreveria pedindo 'admin'. Nesta rota quem
   * escolhe já passou pelo @SoAdmin(), então a escolha é dele por direito.
   *
   * O padrão continua sendo 'operador' — quem esquecer de mandar o campo
   * cria a conta menos poderosa, não a mais.
   *
   * Nenhum token é devolvido: devolver um aqui derrubaria a sessão do admin
   * se o front resolvesse guardá-lo, e ele viraria o usuário que acabou de
   * criar.
   */
  async criarUsuario(dto: CriarUsuarioDto): Promise<UsuarioDaSessao> {
    const jaExiste = await this.usuarios.exists({ where: { email: dto.email } })
    if (jaExiste) {
      throw new ErroDeRegra('Já existe uma conta com esse e-mail.')
    }

    const usuario = await this.usuarios.save(
      this.usuarios.create({
        id: randomUUID(),
        nome: dto.nome,
        email: dto.email,
        senhaHash: await bcrypt.hash(dto.senha, CUSTO_HASH),
        papel: dto.papel ?? 'operador',
        ativo: true,
      }),
    )

    return this.paraSessao(usuario)
  }

  private paraSessao(u: Usuario): UsuarioDaSessao {
    return { id: u.id, nome: u.nome, email: u.email, papel: u.papel }
  }

  private assinar(u: Usuario): Promise<string> {
    const conteudo: Conteudo = { sub: u.id, papel: u.papel }
    return this.jwt.signAsync(conteudo)
  }
}
