import { describe, expect, it } from 'vitest'
import {
  MAX_HOUR_LOG_HOURS,
  MIN_HOUR_LOG_HOURS,
  validateHourLogHours,
  validateHourLogInput,
  validateHourLogTime,
  validateHourLogTimes,
} from './hour-log.validation'

describe('hour log validation', () => {
  it('accepts the configured hour boundaries and a valid time range', () => {
    expect(() => validateHourLogHours(MIN_HOUR_LOG_HOURS)).not.toThrow()
    expect(() => validateHourLogHours(MAX_HOUR_LOG_HOURS)).not.toThrow()
    expect(() => validateHourLogInput({ hours: 4, startTime: '08:00', endTime: '12:00' })).not.toThrow()
  })

  it.each([0, 10.1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid duration %s', (hours) => {
    expect(() => validateHourLogHours(hours)).toThrow('las horas deben estar entre 0.5 y 10')
  })

  it.each(['8:00', '24:00', '12:60'])('rejects invalid time %s', (time) => {
    expect(() => validateHourLogTime(time)).toThrow('formato HH:mm')
  })

  it('rejects a range whose start is not before its end', () => {
    expect(() => validateHourLogTimes({ startTime: '12:00', endTime: '12:00' })).toThrow(
      'la hora de inicio debe ser anterior a la de fin',
    )
  })
})
