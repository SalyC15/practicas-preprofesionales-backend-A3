import { IsEmail, IsOptional, IsString } from 'class-validator'

export class UpdateCompanyDto {
  @IsOptional()
  @IsString({ message: 'El nombre debe ser un texto válido' })
  name?: string

  @IsOptional()
  @IsString({ message: 'El sector debe ser un texto válido' })
  sector?: string

  @IsOptional()
  @IsEmail({}, { message: 'El correo de contacto debe ser un correo válido' })
  contactEmail?: string

  @IsOptional()
  @IsString({ message: 'El teléfono debe ser un texto válido' })
  phone?: string

  @IsOptional()
  @IsString({ message: 'La dirección debe ser un texto válido' })
  address?: string

  @IsOptional()
  @IsString({ message: 'La URL del logo debe ser un texto válido' })
  logoUrl?: string

  @IsOptional()
  @IsString({ message: 'La descripción debe ser un texto válido' })
  description?: string

  @IsOptional()
  @IsString({ message: 'El sitio web debe ser un texto válido' })
  website?: string
}
