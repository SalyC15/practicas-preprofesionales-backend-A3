import type { Role } from '@prisma/client'

export interface JwtAuthPayload {
  sub: number
  email: string
  role: Role
  sessionId: string
  generation: number
  iat?: number
  exp?: number
}

export interface UserResponseDto {
  id: number
  email: string
  fullName: string
  role: Role
  companyId: number | null
}

export interface AuthSuccessResponse {
  accessToken: string
  expiresAt: number
  user: UserResponseDto
}

export interface InternalAuthResult extends AuthSuccessResponse {
  sessionId: string
  generation: number
  refreshTokenSecret: string
  refreshExpiresAt: Date
  oldCookieName?: string
  prunedCookieNames?: string[]
}
