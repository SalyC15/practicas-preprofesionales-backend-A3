import { IsDefined, IsInt, IsString, Matches, Max, MaxLength, Min } from 'class-validator'
import {
  HOUR_LOG_TIME_PATTERN,
  MAX_HOUR_LOG_HOURS,
  MIN_HOUR_LOG_HOURS,
} from '../hour-log.validation'

export class CreateHourLogDto {
  @IsInt() placementId!: number

  @IsDefined() date!: string | Date

  @Matches(HOUR_LOG_TIME_PATTERN) startTime!: string

  @Matches(HOUR_LOG_TIME_PATTERN) endTime!: string

  @Min(MIN_HOUR_LOG_HOURS) @Max(MAX_HOUR_LOG_HOURS) hours!: number

  @IsString() @MaxLength(500) activity!: string
}
