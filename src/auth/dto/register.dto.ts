import { IsEmail, IsString, MinLength } from 'class-validator'

export class RegisterDto {
  @IsString({ message: 'El nombre completo es requerido' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  fullName!: string

  @IsEmail({}, { message: 'El correo electrónico debe ser válido' })
  email!: string

  @IsString({ message: 'La contraseña es requerida' })
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  password!: string
}
