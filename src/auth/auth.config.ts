import { AUTH_DEFAULTS } from './auth.constants'

function parseStrictPositiveInt(
  raw: string | undefined,
  defaultValue: number,
  min: number,
  max: number,
  varName: string,
): number {
  if (!raw) return defaultValue
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Configuración ${varName} debe ser un entero positivo válido, recibido: "${raw}"`)
  }
  const val = Number(trimmed)
  if (!Number.isSafeInteger(val) || val < min || val > max) {
    throw new Error(`Configuración ${varName} (${val}) fuera del rango permitido [${min}, ${max}] segundos`)
  }
  return val
}

export class AuthConfig {
  static getJwtSecret(): string {
    const secret = process.env.JWT_SECRET?.trim()
    if (!secret) {
      throw new Error('JWT_SECRET no configurado en las variables de entorno')
    }
    if (secret === AUTH_DEFAULTS.INSECURE_SECRET_FALLBACK) {
      throw new Error('JWT_SECRET no puede usar el valor inseguro por defecto documentado en D-07')
    }
    return secret
  }

  static getAccessTokenTtlSec(): number {
    return parseStrictPositiveInt(
      process.env.AUTH_ACCESS_TOKEN_TTL_SEC,
      AUTH_DEFAULTS.ACCESS_TOKEN_TTL_SEC,
      AUTH_DEFAULTS.ACCESS_TOKEN_MIN_SEC,
      AUTH_DEFAULTS.ACCESS_TOKEN_MAX_SEC,
      'AUTH_ACCESS_TOKEN_TTL_SEC',
    )
  }

  static getRefreshTokenTtlSec(): number {
    const accessTtl = AuthConfig.getAccessTokenTtlSec()
    const refreshTtl = parseStrictPositiveInt(
      process.env.AUTH_REFRESH_TOKEN_TTL_SEC,
      AUTH_DEFAULTS.REFRESH_TOKEN_TTL_SEC,
      AUTH_DEFAULTS.REFRESH_TOKEN_MIN_SEC,
      AUTH_DEFAULTS.REFRESH_TOKEN_MAX_SEC,
      'AUTH_REFRESH_TOKEN_TTL_SEC',
    )

    if (refreshTtl < accessTtl * 2) {
      throw new Error(
        `Configuración AUTH_REFRESH_TOKEN_TTL_SEC (${refreshTtl}s) debe ser al menos el doble de AUTH_ACCESS_TOKEN_TTL_SEC (${accessTtl}s)`,
      )
    }
    return refreshTtl
  }

  static getTrustedOrigins(): string[] {
    const origin = process.env.CORS_ORIGIN ?? 'http://localhost:5173'
    return origin.split(',').map((o) => o.trim()).filter(Boolean)
  }

  static isProduction(): boolean {
    return process.env.NODE_ENV === 'production'
  }
}
