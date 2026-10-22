import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator'

export class CreateCompanyDto {
  @IsString({ message: 'El RUC/identificación fiscal es requerido' })
  taxId!: string

  @IsString({ message: 'El nombre de la empresa es requerido' })
  name!: string

  @IsString({ message: 'El sector de la empresa es requerido' })
  sector!: string

  @IsEmail({}, { message: 'El correo electrónico de contacto debe ser válido' })
  contactEmail!: string

  @IsOptional()
  @IsString({ message: 'La contraseña debe ser un texto' })
  @MinLength(6, { message: 'La contraseña de acceso debe tener al menos 6 caracteres' })
  password?: string

  @IsOptional()
  @IsBoolean({ message: 'El campo de verificación debe ser un valor booleano' })
  verified?: boolean
}
