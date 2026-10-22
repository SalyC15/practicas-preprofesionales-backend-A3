import { Type } from 'class-transformer'
import { IsDate, IsInt, IsString, Min } from 'class-validator'

export class CreateOfferDto {
  @IsInt({ message: 'El ID de la empresa debe ser un número entero' })
  companyId!: number

  @IsString({ message: 'El título de la oferta es requerido' })
  title!: string

  @IsString({ message: 'La descripción es requerida' })
  description!: string

  @IsString({ message: 'La modalidad es requerida' })
  modality!: string

  @IsInt({ message: 'Los cupos deben ser un número entero' })
  @Min(1, { message: 'Debe haber al menos 1 cupo' })
  seats!: number

  @IsInt({ message: 'Las horas requeridas deben ser un número entero' })
  @Min(1, { message: 'Debe haber al menos 1 hora requerida' })
  requiredHours!: number

  @Type(() => Date)
  @IsDate({ message: 'La fecha de inicio debe ser válida' })
  periodStart!: Date

  @Type(() => Date)
  @IsDate({ message: 'La fecha de fin debe ser válida' })
  periodEnd!: Date
}
