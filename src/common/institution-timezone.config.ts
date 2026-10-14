import { validateInstitutionTimeZone } from './calendar-date'

export const DEFAULT_INSTITUTION_TIMEZONE = 'America/Guayaquil'

export class InstitutionTimezoneConfig {
  readonly timeZone: string

  constructor(
    timeZone = process.env.INSTITUTION_TIMEZONE?.trim() || DEFAULT_INSTITUTION_TIMEZONE,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.timeZone = validateInstitutionTimeZone(timeZone)
  }

  now(): Date {
    return this.clock()
  }
}
