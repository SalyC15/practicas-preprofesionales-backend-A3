import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { describe, expect, it } from 'vitest'
import { CreateHourLogDto } from './create-hour-log.dto'

describe('CreateHourLogDto calendar date input', () => {
  it('preserves a raw date string instead of transforming it into a Date instant', () => {
    const dto = plainToInstance(CreateHourLogDto, { date: '2026-10-13' })

    expect(dto.date).toBe('2026-10-13')
  })

  it('preserves offset ISO strings so the service can normalize them in the institution timezone', () => {
    const dto = plainToInstance(CreateHourLogDto, { date: '2026-10-13T23:30:00-05:00' })

    expect(dto.date).toBe('2026-10-13T23:30:00-05:00')
  })

  it('preserves Date objects as instants for internal callers', () => {
    const date = new Date('2026-10-14T04:30:00.000Z')
    const dto = plainToInstance(CreateHourLogDto, { date })

    expect(dto.date).toBeInstanceOf(Date)
    expect((dto.date as Date).getTime()).toBe(date.getTime())
  })
})
