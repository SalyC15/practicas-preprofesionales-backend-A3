import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_INSTITUTION_TIMEZONE, InstitutionTimezoneConfig } from './institution-timezone.config'

describe('InstitutionTimezoneConfig', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('defaults to America/Guayaquil and exposes an injectable clock', () => {
    vi.stubEnv('INSTITUTION_TIMEZONE', '')
    const now = new Date('2026-10-14T01:00:00.000Z')
    const config = new InstitutionTimezoneConfig(undefined, () => now)

    expect(config.timeZone).toBe(DEFAULT_INSTITUTION_TIMEZONE)
    expect(config.now()).toBe(now)
  })

  it('uses an explicit timezone in preference to the environment setting', () => {
    vi.stubEnv('INSTITUTION_TIMEZONE', 'America/Guayaquil')

    expect(new InstitutionTimezoneConfig('Europe/Madrid').timeZone).toBe('Europe/Madrid')
  })

  it('rejects an invalid configured timezone', () => {
    vi.stubEnv('INSTITUTION_TIMEZONE', 'America/Nowhere')

    expect(() => new InstitutionTimezoneConfig()).toThrow(/INSTITUTION_TIMEZONE.*inválida/)
  })
})
