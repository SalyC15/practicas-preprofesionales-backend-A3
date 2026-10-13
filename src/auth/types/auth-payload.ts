import { Role } from '@prisma/client'
import type { JwtAuthPayload } from './auth.types'

const ALLOWED_ROLES = new Set(Object.values(Role))

export function validateJwtAuthPayload(payload: unknown): JwtAuthPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload del token debe ser un objeto')
  }

  const p = payload as Record<string, unknown>

  // sub: positive safe integer
  if (
    typeof p.sub !== 'number' ||
    !Number.isSafeInteger(p.sub) ||
    p.sub <= 0
  ) {
    throw new Error('Claim "sub" debe ser un entero positivo seguro')
  }

  // generation: positive safe integer
  if (
    typeof p.generation !== 'number' ||
    !Number.isSafeInteger(p.generation) ||
    p.generation <= 0
  ) {
    throw new Error('Claim "generation" debe ser un entero positivo seguro')
  }

  // sessionId: non-empty bounded string (max 128 chars)
  if (
    typeof p.sessionId !== 'string' ||
    p.sessionId.trim().length === 0 ||
    p.sessionId.length > 128
  ) {
    throw new Error('Claim "sessionId" debe ser un string no vacío de máximo 128 caracteres')
  }

  // exp: mandatory finite integer
  if (
    typeof p.exp !== 'number' ||
    !Number.isFinite(p.exp) ||
    !Number.isSafeInteger(p.exp)
  ) {
    throw new Error('Claim "exp" es obligatorio y debe ser un entero finito')
  }

  // email: optional in raw, but if provided must be valid string
  if (p.email !== undefined) {
    if (typeof p.email !== 'string' || !p.email.includes('@') || p.email.length > 255) {
      throw new Error('Claim "email" inválido')
    }
  }

  // role: optional in raw, but if provided must be valid enum Role
  if (p.role !== undefined) {
    if (typeof p.role !== 'string' || !ALLOWED_ROLES.has(p.role as Role)) {
      throw new Error(`Claim "role" inválido: ${p.role}`)
    }
  }

  return {
    sub: p.sub,
    generation: p.generation,
    sessionId: p.sessionId.trim(),
    exp: p.exp,
    email: (p.email as string) ?? '',
    role: (p.role as Role) ?? Role.STUDENT,
    iat: typeof p.iat === 'number' && Number.isSafeInteger(p.iat) ? p.iat : undefined,
  }
}
