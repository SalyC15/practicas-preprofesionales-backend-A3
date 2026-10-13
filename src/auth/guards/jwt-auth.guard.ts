import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../../prisma/prisma.service'
import { validateJwtAuthPayload } from '../types/auth-payload'
import type { JwtAuthPayload } from '../types/auth.types'

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const header: string | undefined = request.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) throw new UnauthorizedException('falta el token')

    let rawPayload: unknown
    try {
      rawPayload = await this.jwt.verifyAsync(token)
    } catch {
      throw new UnauthorizedException('token inválido')
    }

    let payload: JwtAuthPayload
    try {
      payload = validateJwtAuthPayload(rawPayload)
    } catch {
      throw new UnauthorizedException('estructura de sesión inválida en el token')
    }

    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sessionId },
    })

    if (!session || session.revokedAt !== null || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('sesión inválida o expirada')
    }

    // Ownership assertion: session userId must match payload sub
    if (session.userId !== payload.sub) {
      throw new UnauthorizedException('propietario de sesión no coincide')
    }

    // Immediately reject old access token whose generation was rotated
    if (session.generation !== payload.generation) {
      throw new UnauthorizedException('token revocado por renovación de sesión')
    }

    request.user = payload
    return true
  }
}
