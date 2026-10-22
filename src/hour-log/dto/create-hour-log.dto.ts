import { IsDefined, IsInt, IsString, Matches, Max, MaxLength, Min } from 'class-validator'
import {
  HOUR_LOG_TIME_PATTERN,
  MAX_HOUR_LOG_HOURS,
  MIN_HOUR_LOG_HOURS,
} from '../hour-log.validation'

export class CreateHourLogDto {
  @IsInt({ message: 'El ID de la práctica debe ser un número entero' })
  placementId!: number

  @IsDefined({ message: 'La fecha es requerida' })
  date!: string | Date

  @Matches(HOUR_LOG_TIME_PATTERN, { message: 'La hora de inicio debe tener el formato HH:MM (24h)' })
  startTime!: string

  @Matches(HOUR_LOG_TIME_PATTERN, { message: 'La hora de fin debe tener el formato HH:MM (24h)' })
  endTime!: string

  @Min(MIN_HOUR_LOG_HOURS, { message: `Las horas no pueden ser menores a ${MIN_HOUR_LOG_HOURS}` })
  @Max(MAX_HOUR_LOG_HOURS, { message: `Las horas no pueden ser mayores a ${MAX_HOUR_LOG_HOURS}` })
  hours!: number

  @IsString({ message: 'La descripción de la actividad debe ser un texto' })
  @MaxLength(500, { message: 'La descripción de la actividad no puede superar los 500 caracteres' })
  activity!: string
}
