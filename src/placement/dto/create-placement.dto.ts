import { IsInt } from 'class-validator'

export class CreatePlacementDto {
  @IsInt({ message: 'El ID de la postulación debe ser un número entero' })
  applicationId!: number

  @IsInt({ message: 'El ID del tutor debe ser un número entero' })
  tutorId!: number
}
