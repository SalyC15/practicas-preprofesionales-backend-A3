import * as crypto from 'node:crypto'
import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Role } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from '../prisma/prisma.service'
import { AuthConfig } from './auth.config'
import { AUTH_DEFAULTS } from './auth.constants'
import { validateJwtAuthPayload } from './types/auth-payload'
import type { InternalAuthResult, JwtAuthPayload } from './types/auth.types'
import { getGenerationCookieName, parseGenerationCookieName } from './utils/cookie.util'

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private hashSecret(secret: string): string {
    return crypto.createHash('sha256').update(secret).digest('hex')
  }

  async login(
    email: string,
    password: string,
    presentedCookies?: Record<string, string>,
  ): Promise<InternalAuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException('credenciales inválidas')
    }

    const prunedCookieNames: string[] = []

    // If browser presented auth cookies, inspect and safely retire prior valid sessions
    // with cryptographic proof of possession (hash of raw secret matching DB record).
    if (presentedCookies) {
      const cookieKeys = Object.keys(presentedCookies)
      const authCookieNames = cookieKeys.filter(
        (name) => parseGenerationCookieName(name) !== null,
      )
      if (
        cookieKeys.length > 50 ||
        authCookieNames.length > AUTH_DEFAULTS.MAX_AUTH_COOKIES_PARSED
      ) {
        throw new UnauthorizedException('demasiadas cookies de autenticación presentadas')
      }

      for (const cookieName of authCookieNames) {
        const parsed = parseGenerationCookieName(cookieName)
        if (!parsed) continue

        const rawSecret = presentedCookies[cookieName]
        if (!rawSecret) continue

        const incomingHash = this.hashSecret(rawSecret)

        // Atomic retirement: only revokes if possession proof matches current generation
        const retired = await this.prisma.authSession.updateMany({
          where: {
            id: parsed.sessionId,
            generation: parsed.generation,
            refreshTokenHash: incomingHash,
            revokedAt: null,
          },
          data: {
            revokedAt: new Date(),
          },
        })

        if (retired.count > 0) {
          prunedCookieNames.push(cookieName)
        } else {
          // If session is already revoked, expired, nonexistent, or generation is stale,
          // it is safe to prune this specific old cookie name from the browser without
          // touching or revoking any active/newer session state.
          const existing = await this.prisma.authSession.findUnique({
            where: { id: parsed.sessionId },
          })
          if (
            !existing ||
            existing.revokedAt !== null ||
            existing.expiresAt <= new Date() ||
            existing.generation > parsed.generation
          ) {
            prunedCookieNames.push(cookieName)
          }
        }
      }
    }

    const sessionId = crypto.randomUUID()
    const refreshTokenSecret = crypto.randomBytes(32).toString('hex')
    const refreshTokenHash = this.hashSecret(refreshTokenSecret)

    const accessTtlSec = AuthConfig.getAccessTokenTtlSec()
    const refreshTtlSec = AuthConfig.getRefreshTokenTtlSec()
    const now = Date.now()
    const expiresAtDate = new Date(now + refreshTtlSec * 1000)

    await this.prisma.authSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        generation: 1,
        refreshTokenHash,
        expiresAt: expiresAtDate,
      },
    })

    const payload: JwtAuthPayload = {
      sub: user.id,
      email: user.email,
      role: user.role as Role,
      sessionId,
      generation: 1,
    }

    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: accessTtlSec,
    })

    const decoded = this.jwt.decode(accessToken) as { exp?: number } | null
    const expiresAt = decoded?.exp
      ? decoded.exp * 1000
      : Math.floor(now / 1000 + accessTtlSec) * 1000

    return {
      accessToken,
      expiresAt,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role as Role,
        companyId: user.companyId,
      },
      sessionId,
      generation: 1,
      refreshTokenSecret,
      refreshExpiresAt: expiresAtDate,
      prunedCookieNames,
    }
  }

  async refresh(
    bearerToken: string,
    cookies: Record<string, string>,
  ): Promise<InternalAuthResult> {
    let rawPayload: unknown
    try {
      rawPayload = await this.jwt.verifyAsync(bearerToken, {
        ignoreExpiration: false, // Strict: renewal MUST happen before expiration
      })
    } catch {
      throw new UnauthorizedException('token de acceso inválido o expirado')
    }

    let payload: JwtAuthPayload
    try {
      payload = validateJwtAuthPayload(rawPayload)
    } catch {
      throw new UnauthorizedException('token con estructura de claims inválida')
    }

    const expectedCookieName = getGenerationCookieName(payload.sessionId, payload.generation)
    const rawSecret = cookies[expectedCookieName]

    if (!rawSecret) {
      throw new UnauthorizedException('credencial de renovación ausente')
    }

    const incomingHash = this.hashSecret(rawSecret)
    const newSecret = crypto.randomBytes(32).toString('hex')
    const newHash = this.hashSecret(newSecret)
    const nextGeneration = payload.generation + 1

    // Atomic Compare-And-Swap (CAS)
    const result = await this.prisma.authSession.updateMany({
      where: {
        id: payload.sessionId,
        userId: payload.sub,
        generation: payload.generation,
        refreshTokenHash: incomingHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: {
        generation: nextGeneration,
        refreshTokenHash: newHash,
        updatedAt: new Date(),
      },
    })

    if (result.count === 0) {
      // Differentiate stale/replay from dead session
      const existing = await this.prisma.authSession.findUnique({
        where: { id: payload.sessionId },
      })

      if (!existing || existing.revokedAt !== null || existing.expiresAt <= new Date()) {
        throw new UnauthorizedException('sesión inválida o expirada')
      }

      // Session is still active at a newer generation -> replay/concurrency, do not revoke!
      throw new UnauthorizedException('solicitud de renovación inválida o ya procesada')
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } })
    if (!user) {
      throw new UnauthorizedException('usuario no encontrado')
    }

    const sessionRecord = await this.prisma.authSession.findUnique({
      where: { id: payload.sessionId },
    })

    const refreshExpiresAt = sessionRecord?.expiresAt ?? new Date(Date.now() + AuthConfig.getRefreshTokenTtlSec() * 1000)

    const accessTtlSec = AuthConfig.getAccessTokenTtlSec()
    const now = Date.now()

    const nextPayload: JwtAuthPayload = {
      sub: user.id,
      email: user.email,
      role: user.role as Role,
      sessionId: payload.sessionId,
      generation: nextGeneration,
    }

    const newAccessToken = await this.jwt.signAsync(nextPayload, {
      expiresIn: accessTtlSec,
    })

    const decoded = this.jwt.decode(newAccessToken) as { exp?: number } | null
    const expiresAt = decoded?.exp
      ? decoded.exp * 1000
      : Math.floor(now / 1000 + accessTtlSec) * 1000

    return {
      accessToken: newAccessToken,
      expiresAt,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role as Role,
        companyId: user.companyId,
      },
      sessionId: payload.sessionId,
      generation: nextGeneration,
      refreshTokenSecret: newSecret,
      refreshExpiresAt,
      oldCookieName: expectedCookieName,
    }
  }

  async logout(bearerToken: string): Promise<{ sessionId: string; generation: number }> {
    let rawPayload: unknown
    try {
      // Must verify cryptographic signature! Ignore expiration only to identify session.
      rawPayload = await this.jwt.verifyAsync(bearerToken, {
        ignoreExpiration: true,
      })
    } catch {
      throw new UnauthorizedException('token inválido')
    }

    let payload: JwtAuthPayload
    try {
      payload = validateJwtAuthPayload(rawPayload)
    } catch {
      throw new UnauthorizedException('token sin identificadores de sesión válidos')
    }

    await this.prisma.authSession.updateMany({
      where: {
        id: payload.sessionId,
        userId: payload.sub,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    })

    return {
      sessionId: payload.sessionId,
      generation: payload.generation,
    }
  }
}
