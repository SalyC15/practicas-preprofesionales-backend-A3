import { HourLogStatus } from '@prisma/client'
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

export class ReviewHourLogDto {
  @IsIn([HourLogStatus.APPROVED, HourLogStatus.REJECTED], {
    message: 'El estado debe ser APPROVED o REJECTED',
  })
  status!: HourLogStatus

  @IsOptional()
  @IsString({ message: 'La nota debe ser un texto' })
  @MaxLength(300, { message: 'La nota no puede superar los 300 caracteres' })
  note?: string
}
