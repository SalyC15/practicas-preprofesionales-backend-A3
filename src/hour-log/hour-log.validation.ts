export const MIN_HOUR_LOG_HOURS = 0.5
export const MAX_HOUR_LOG_HOURS = 10
export const HOUR_LOG_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export class HourLogValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HourLogValidationError'
  }
}

export interface HourLogTimeInput {
  startTime: string
  endTime: string
}

export interface HourLogInput extends HourLogTimeInput {
  hours: number
}

export function validateHourLogHours(hours: number): void {
  if (!Number.isFinite(hours) || hours < MIN_HOUR_LOG_HOURS || hours > MAX_HOUR_LOG_HOURS) {
    throw new HourLogValidationError(`las horas deben estar entre ${MIN_HOUR_LOG_HOURS} y ${MAX_HOUR_LOG_HOURS}`)
  }
}

export function validateHourLogTimes({ startTime, endTime }: HourLogTimeInput): void {
  validateHourLogTime(startTime)
  validateHourLogTime(endTime)

  const toMinutes = (time: string) => {
    const [hour, minute] = time.split(':').map(Number)
    return hour * 60 + minute
  }

  if (toMinutes(startTime) >= toMinutes(endTime)) {
    throw new HourLogValidationError('la hora de inicio debe ser anterior a la de fin')
  }
}

export function validateHourLogTime(time: string): void {
  if (!HOUR_LOG_TIME_PATTERN.test(time)) {
    throw new HourLogValidationError('las horas deben tener el formato HH:mm')
  }
}

export function validateHourLogInput(input: HourLogInput): void {
  validateHourLogHours(input.hours)
  validateHourLogTimes(input)
}
