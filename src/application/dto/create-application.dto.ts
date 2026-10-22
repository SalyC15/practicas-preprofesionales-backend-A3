import { IsInt, IsString, MinLength } from 'class-validator'

export class CreateApplicationDto {
  @IsInt({ message: 'El ID de la oferta debe ser un número entero' })
  offerId!: number

  @IsString({ message: 'La motivación es requerida' })
  @MinLength(20, { message: 'La motivación debe tener al menos 20 caracteres' })
  motivation!: string
}
