import { AuthConfig } from '../auth.config'
import { AUTH_DEFAULTS } from '../auth.constants'

export interface CookieOptions {
  httpOnly?: boolean
  sameSite?: 'strict' | 'lax' | 'none' | boolean
  secure?: boolean
  path?: string
  maxAge?: number
}

export function getGenerationCookieName(sessionId: string, generation: number): string {
  return `${AUTH_DEFAULTS.COOKIE_PREFIX}${sessionId}_g${generation}`
}

export function parseGenerationCookieName(cookieName: string): { sessionId: string; generation: number } | null {
  if (!cookieName.startsWith(AUTH_DEFAULTS.COOKIE_PREFIX)) return null
  const rest = cookieName.slice(AUTH_DEFAULTS.COOKIE_PREFIX.length)
  const match = rest.match(/^(.*)_g(\d+)$/)
  if (!match) return null
  const [, sessionId, genStr] = match
  const generation = Number(genStr)
  if (!sessionId || sessionId.length > 64 || !Number.isSafeInteger(generation) || generation <= 0) return null
  return { sessionId, generation }
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return Object.create(null)
  if (cookieHeader.length > AUTH_DEFAULTS.MAX_COOKIE_HEADER_BYTES) {
    throw new Error('Cabecera Cookie excede el tamaño máximo permitido')
  }
  const cookies: Record<string, string> = Object.create(null)
  const items = cookieHeader.split(';')
  for (const item of items) {
    const idx = item.indexOf('=')
    if (idx === -1) continue
    const key = item.slice(0, idx).trim()
    const val = item.slice(idx + 1).trim()
    // Protect against prototype pollution keys
    if (key && key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
      try {
        cookies[key] = decodeURIComponent(val)
      } catch {
        cookies[key] = val
      }
    }
  }
  return cookies
}

export function findSessionCookies(cookies: Record<string, string>, sessionId: string): string[] {
  const matching: string[] = []
  for (const name of Object.keys(cookies)) {
    const parsed = parseGenerationCookieName(name)
    if (parsed && parsed.sessionId === sessionId) {
      matching.push(name)
    }
  }
  return matching
}

export function getCookieOptions(ttlSec: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: AuthConfig.isProduction(),
    path: '/api/auth',
    maxAge: ttlSec * 1000,
  }
}

export function getClearCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: AuthConfig.isProduction(),
    path: '/api/auth',
    maxAge: 0,
  }
}
