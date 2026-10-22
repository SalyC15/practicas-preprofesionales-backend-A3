import { IsEmail, IsString, MinLength } from 'class-validator'

export class LoginDto {
  @IsEmail({}, { message: 'El correo electrónico debe ser válido' })
  email!: string

  @IsString({ message: 'La contraseña es requerida' })
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  password!: string
}
