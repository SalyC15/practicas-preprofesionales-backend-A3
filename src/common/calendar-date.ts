export class CalendarDateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CalendarDateError'
  }
}

export interface NormalizedCalendarDate {
  dateString: string
  utcMidnight: Date
}

export interface PlacementCalendarRange {
  startDate: Date
  endDate: Date | null
}

const PURE_CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i
const DAY_IN_MILLISECONDS = 86_400_000

function isValidCalendarDate(dateString: string): boolean {
  if (!PURE_CALENDAR_DATE.test(dateString)) return false
  const date = new Date(`${dateString}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateString
}

export function validateInstitutionTimeZone(timeZone: string): string {
  if (typeof timeZone !== 'string' || !timeZone.trim()) {
    throw new Error('INSTITUTION_TIMEZONE no puede estar vacío')
  }

  const normalizedTimeZone = timeZone.trim()
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalizedTimeZone }).format(new Date(0))
  } catch {
    throw new Error(`INSTITUTION_TIMEZONE "${normalizedTimeZone}" es inválida`)
  }
  return normalizedTimeZone
}

function institutionalDateString(instant: Date, timeZone: string): string {
  const normalizedTimeZone = validateInstitutionTimeZone(timeZone)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: normalizedTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value
  const year = part('year')
  const month = part('month')
  const day = part('day')
  if (!year || !month || !day) throw new CalendarDateError('no se pudo obtener la fecha institucional')
  return `${year.padStart(4, '0')}-${month}-${day}`
}

function utcMidnight(dateString: string): Date {
  return new Date(`${dateString}T00:00:00.000Z`)
}

export function getUtcCalendarDate(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new CalendarDateError('fecha almacenada inválida')
  }
  const year = String(date.getUTCFullYear()).padStart(4, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function normalizeToInstitutionCalendarDate(input: string | Date, timeZone: string): NormalizedCalendarDate {
  validateInstitutionTimeZone(timeZone)

  if (typeof input === 'string' && PURE_CALENDAR_DATE.test(input)) {
    if (!isValidCalendarDate(input)) {
      throw new CalendarDateError(`fecha inválida: "${input}" no es un día calendario real`)
    }
    return { dateString: input, utcMidnight: utcMidnight(input) }
  }

  let instant: Date
  if (input instanceof Date) {
    instant = input
  } else if (typeof input === 'string' && ISO_INSTANT.test(input) && isValidCalendarDate(input.slice(0, 10))) {
    instant = new Date(input)
  } else {
    throw new CalendarDateError('fecha inválida; use YYYY-MM-DD o una fecha ISO con zona horaria')
  }

  if (Number.isNaN(instant.getTime())) {
    throw new CalendarDateError('fecha inválida; use YYYY-MM-DD o una fecha ISO con zona horaria')
  }

  const dateString = institutionalDateString(instant, timeZone)
  return { dateString, utcMidnight: utcMidnight(dateString) }
}

export function getCurrentDateInInstitutionTz(timeZone: string, now: Date = new Date()): string {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new CalendarDateError('fecha actual inválida')
  }
  return institutionalDateString(now, timeZone)
}

export function validateHourLogCalendarDate(
  input: string | Date,
  placement: PlacementCalendarRange,
  timeZone: string,
  now: Date = new Date(),
): NormalizedCalendarDate {
  const normalized = normalizeToInstitutionCalendarDate(input, timeZone)
  const todayString = getCurrentDateInInstitutionTz(timeZone, now)
  if (normalized.dateString > todayString) {
    throw new CalendarDateError('No se pueden registrar horas con fecha futura')
  }

  const placementStartString = getUtcCalendarDate(placement.startDate)
  const placementEndString = placement.endDate ? getUtcCalendarDate(placement.endDate) : null
  if (
    normalized.dateString < placementStartString ||
    (placementEndString !== null && normalized.dateString > placementEndString)
  ) {
    const validRange = placementEndString
      ? `${placementStartString} a ${placementEndString}`
      : `desde ${placementStartString}, sin fecha de fin definida`
    throw new CalendarDateError(
      `La fecha del registro (${normalized.dateString}) está fuera del rango válido de la práctica (${validRange}).`,
    )
  }

  return normalized
}

export function getUtcCalendarDayDistance(startDate: Date, endDate: Date): number {
  const start = utcMidnight(getUtcCalendarDate(startDate))
  const end = utcMidnight(getUtcCalendarDate(endDate))
  return Math.round((end.getTime() - start.getTime()) / DAY_IN_MILLISECONDS)
}
