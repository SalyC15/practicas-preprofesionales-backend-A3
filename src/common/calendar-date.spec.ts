import { describe, expect, it } from 'vitest'
import {
  CalendarDateError,
  getCurrentDateInInstitutionTz,
  getUtcCalendarDate,
  normalizeToInstitutionCalendarDate,
  validateHourLogCalendarDate,
} from './calendar-date'

const GUAYAQUIL = 'America/Guayaquil'

describe('calendar date helpers', () => {
  it.each([
    ['2026-10-13', '2026-10-13'],
    ['2026-10-13T23:30:00-05:00', '2026-10-13'],
    ['2026-10-14T04:30:00.000Z', '2026-10-13'],
    ['2026-10-14T06:30:00+02:00', '2026-10-13'],
    ['2026-10-13T21:30:00+09:00', '2026-10-13'],
  ])('normalizes %s to the calendar day %s in Guayaquil', (input, expected) => {
    expect(normalizeToInstitutionCalendarDate(input, GUAYAQUIL)).toEqual({
      dateString: expected,
      utcMidnight: new Date(`${expected}T00:00:00.000Z`),
    })
  })

  it('normalizes Date objects as instants and never shifts a pure date', () => {
    expect(normalizeToInstitutionCalendarDate(new Date('2026-10-14T04:30:00.000Z'), GUAYAQUIL).dateString).toBe(
      '2026-10-13',
    )
    expect(normalizeToInstitutionCalendarDate('2026-10-14', GUAYAQUIL).dateString).toBe('2026-10-14')
  })

  it('uses the configured timezone for an instant at the institution day boundary', () => {
    const instant = '2026-10-14T02:00:00.000Z'
    expect(normalizeToInstitutionCalendarDate(instant, GUAYAQUIL).dateString).toBe('2026-10-13')
    expect(normalizeToInstitutionCalendarDate(instant, 'Europe/Madrid').dateString).toBe('2026-10-14')
  })

  it.each(['2026-02-30', '2026-02-30T12:00:00Z', '2026-10-13T12:00:00'])('rejects invalid or timezone-less input %s', (input) => {
    expect(() => normalizeToInstitutionCalendarDate(input, GUAYAQUIL)).toThrow(CalendarDateError)
  })

  it('gets today in the institutional timezone across a UTC day boundary', () => {
    expect(getCurrentDateInInstitutionTz(GUAYAQUIL, new Date('2026-10-14T01:00:00.000Z'))).toBe('2026-10-13')
  })

  it('validates both inclusive placement bounds using their stored UTC components', () => {
    const placement = {
      startDate: new Date('2026-10-13T23:30:00.000Z'),
      endDate: new Date('2026-10-14T23:30:00.000Z'),
    }
    const now = new Date('2026-10-15T12:00:00.000Z')

    expect(validateHourLogCalendarDate('2026-10-13', placement, GUAYAQUIL, now).dateString).toBe('2026-10-13')
    expect(validateHourLogCalendarDate('2026-10-14', placement, GUAYAQUIL, now).dateString).toBe('2026-10-14')
    expect(() => validateHourLogCalendarDate('2026-10-12', placement, GUAYAQUIL, now)).toThrow(
      'La fecha del registro (2026-10-12) está fuera del rango válido de la práctica (2026-10-13 a 2026-10-14).',
    )
    expect(() => validateHourLogCalendarDate('2026-10-15', placement, GUAYAQUIL, now)).toThrow(
      'La fecha del registro (2026-10-15) está fuera del rango válido de la práctica (2026-10-13 a 2026-10-14).',
    )
  })

  it('rejects tomorrow in Guayaquil even after UTC has crossed midnight', () => {
    const now = new Date('2026-10-14T01:00:00.000Z')
    const placement = {
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: new Date('2026-10-31T00:00:00.000Z'),
    }

    expect(getCurrentDateInInstitutionTz(GUAYAQUIL, now)).toBe('2026-10-13')
    expect(() => validateHourLogCalendarDate('2026-10-14', placement, GUAYAQUIL, now)).toThrow(
      'No se pueden registrar horas con fecha futura',
    )
    expect(validateHourLogCalendarDate('2026-10-13', placement, GUAYAQUIL, now).dateString).toBe('2026-10-13')
  })

  it('reads existing non-midnight rows by their stored UTC day', () => {
    expect(getUtcCalendarDate(new Date('2026-10-13T23:30:00.000Z'))).toBe('2026-10-13')
  })

  it('validates an open-ended placement from its stored UTC start date', () => {
    const placement = { startDate: new Date('2026-10-13T23:30:00.000Z'), endDate: null }
    const now = new Date('2026-10-15T12:00:00.000Z')

    expect(validateHourLogCalendarDate('2026-10-14', placement, GUAYAQUIL, now).dateString).toBe('2026-10-14')
    expect(() => validateHourLogCalendarDate('2026-10-12', placement, GUAYAQUIL, now)).toThrow(
      'La fecha del registro (2026-10-12) está fuera del rango válido de la práctica (desde 2026-10-13, sin fecha de fin definida).',
    )
  })
})
