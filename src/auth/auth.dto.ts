import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { Transform } from 'class-transformer'

import { PAPEIS, type Papel } from '../entidades'

/**
 * As mensagens são as que aparecem na tela. Escrevê-las aqui, junto da
 * regra, é o que impede a validação e o texto de saírem de sincronia —
 * mudar o mínimo da senha sem mudar o aviso é um erro fácil de cometer
 * quando os dois moram em arquivos diferentes.
 */

export class EntrarDto {
  @Transform(({ value }) => String(value ?? '').trim().toLowerCase())
  @IsEmail({}, { message: 'E-mail inválido.' })
  email!: string

  @IsString({ message: 'Preencha a senha.' })
  @MinLength(1, { message: 'Preencha a senha.' })
  senha!: string
}

export class CadastrarDto {
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString({ message: 'Diga seu nome.' })
  @MinLength(1, { message: 'Diga seu nome.' })
  @MaxLength(160, { message: 'O nome ficou longo demais.' })
  nome!: string

  @Transform(({ value }) => String(value ?? '').trim().toLowerCase())
  @IsEmail({}, { message: 'E-mail inválido.' })
  email!: string

  // Seis é o mínimo que o Supabase exigia. Mantido para não invalidar a
  // senha de ninguém na virada — quem já entrava continua entrando.
  @IsString({ message: 'Defina uma senha.' })
  @MinLength(6, { message: 'A senha precisa ter pelo menos 6 caracteres.' })
  @MaxLength(72, { message: 'A senha pode ter no máximo 72 caracteres.' })
  senha!: string
}

/**
 * O que o ADMIN manda ao criar alguém por /api/usuarios.
 *
 * A diferença para o CadastrarDto é uma só, e é a que importa: aqui existe
 * `papel`. No cadastro público ele não existe de propósito — qualquer pessoa
 * poderia se inscrever pedindo 'admin', e o `whitelist: true` do
 * ValidationPipe descarta o campo caladamente se alguém tentar.
 *
 * Aqui o campo é seguro porque a rota já passou pelo @SoAdmin(): quem escolhe
 * o cargo já é administrador. Negar isso não protegeria nada — só obrigaria
 * a promover gente por UPDATE no MySQL, que é pior: sem tela, sem validação
 * e sem ninguém lembrando de conferir depois.
 */
export class CriarUsuarioDto extends CadastrarDto {
  @IsOptional()
  @IsIn(PAPEIS, { message: 'Cargo inválido. Escolha administrador ou operador.' })
  papel?: Papel
}
