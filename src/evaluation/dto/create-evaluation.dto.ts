import { Type } from 'class-transformer'
import { EvaluationKind } from '@prisma/client'
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator'

export class ScoresDto {
  @IsInt({ message: 'El puntaje técnico debe ser un número entero' })
  @Min(1, { message: 'El puntaje técnico mínimo es 1' })
  @Max(5, { message: 'El puntaje técnico máximo es 5' })
  technical!: number

  @IsInt({ message: 'El puntaje de comunicación debe ser un número entero' })
  @Min(1, { message: 'El puntaje de comunicación mínimo es 1' })
  @Max(5, { message: 'El puntaje de comunicación máximo es 5' })
  communication!: number

  @IsInt({ message: 'El puntaje de puntualidad debe ser un número entero' })
  @Min(1, { message: 'El puntaje de puntualidad mínimo es 1' })
  @Max(5, { message: 'El puntaje de puntualidad máximo es 5' })
  punctuality!: number
}

export class CreateEvaluationDto {
  @IsInt({ message: 'El ID de la práctica debe ser un número entero' })
  placementId!: number

  @IsEnum(EvaluationKind, { message: 'El tipo de evaluación debe ser TUTOR, COMPANY o SELF' })
  kind!: EvaluationKind

  @IsString({ message: 'El período debe ser un texto' })
  period!: string

  @ValidateNested({ message: 'Los puntajes deben ser válidos' })
  @Type(() => ScoresDto)
  scores!: ScoresDto

  @IsOptional()
  @IsString({ message: 'El comentario debe ser un texto' })
  @MaxLength(1000, { message: 'El comentario no puede exceder los 1000 caracteres' })
  comment?: string
}
