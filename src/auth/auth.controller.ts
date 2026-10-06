import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common'
import { AuthConfig } from './auth.config'
import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'
import type { AuthSuccessResponse } from './types/auth.types'
import {
  type CookieOptions,
  findSessionCookies,
  getClearCookieOptions,
  getCookieOptions,
  getGenerationCookieName,
  parseCookies,
} from './utils/cookie.util'

interface AuthRequest {
  headers: Record<string, string | string[] | undefined>
  cookies?: Record<string, string>
}

interface AuthResponse {
  cookie(name: string, val: string, options: CookieOptions): void
  clearCookie(name: string, options: CookieOptions): void
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private validateOrigin(req: AuthRequest): void {
    const origin = req.headers.origin as string | undefined
    const referer = req.headers.referer as string | undefined
    const allowed = AuthConfig.getTrustedOrigins()

    if (origin) {
      if (!allowed.includes(origin)) {
        throw new ForbiddenException(`origen no permitido: ${origin}`)
      }
      return
    }

    if (referer) {
      try {
        const parsed = new URL(referer)
        if (parsed.username || parsed.password) {
          throw new ForbiddenException('referer contiene credenciales no permitidas')
        }
        if (!allowed.includes(parsed.origin)) {
          throw new ForbiddenException(`referer no permitido: ${parsed.origin}`)
        }
        return
      } catch (err) {
        if (err instanceof ForbiddenException) throw err
        throw new ForbiddenException(`referer malformado: ${referer}`)
      }
    }

    if (AuthConfig.isProduction()) {
      throw new ForbiddenException('origen ausente o no permitido en producción')
    }
  }

  private extractBearer(req: AuthRequest): string {
    const header = req.headers.authorization
    const headerStr = Array.isArray(header) ? header[0] : header
    if (!headerStr?.startsWith('Bearer ')) {
      throw new UnauthorizedException('falta el token de acceso')
    }
    return headerStr.slice(7)
  }

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: AuthResponse,
    @Req() req: AuthRequest,
  ): Promise<AuthSuccessResponse> {
    this.validateOrigin(req)
    const rawCookie = Array.isArray(req.headers.cookie) ? req.headers.cookie.join(';') : req.headers.cookie
    const cookies = req.cookies ?? parseCookies(rawCookie)

    const result = await this.auth.login(dto.email, dto.password, cookies)

    // Clear any prior valid or stale cookies pruned during account replacement
    if (result.prunedCookieNames && result.prunedCookieNames.length > 0) {
      for (const pruned of result.prunedCookieNames) {
        res.clearCookie(pruned, getClearCookieOptions())
      }
    }

    const cookieName = getGenerationCookieName(result.sessionId, result.generation)
    const remainingSec = Math.max(0, Math.ceil((result.refreshExpiresAt.getTime() - Date.now()) / 1000))
    const cookieOptions = getCookieOptions(remainingSec)
    res.cookie(cookieName, result.refreshTokenSecret, cookieOptions)

    return {
      accessToken: result.accessToken,
      expiresAt: result.expiresAt,
      user: result.user,
    }
  }

  @Post('refresh')
  async refresh(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: AuthResponse,
  ): Promise<AuthSuccessResponse> {
    this.validateOrigin(req)
    const bearer = this.extractBearer(req)
    const rawCookie = Array.isArray(req.headers.cookie) ? req.headers.cookie.join(';') : req.headers.cookie
    const cookies = req.cookies ?? parseCookies(rawCookie)

    const result = await this.auth.refresh(bearer, cookies)

    // Clear previous generation cookie
    if (result.oldCookieName) {
      res.clearCookie(result.oldCookieName, getClearCookieOptions())
    }

    // Set new generation cookie with remaining absolute session lifetime MaxAge
    const newCookieName = getGenerationCookieName(result.sessionId, result.generation)
    const remainingSec = Math.max(0, Math.ceil((result.refreshExpiresAt.getTime() - Date.now()) / 1000))
    res.cookie(
      newCookieName,
      result.refreshTokenSecret,
      getCookieOptions(remainingSec),
    )

    return {
      accessToken: result.accessToken,
      expiresAt: result.expiresAt,
      user: result.user,
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: AuthResponse,
  ): Promise<void> {
    this.validateOrigin(req)
    const bearer = this.extractBearer(req)
    const rawCookie = Array.isArray(req.headers.cookie) ? req.headers.cookie.join(';') : req.headers.cookie
    const cookies = req.cookies ?? parseCookies(rawCookie)

    const { sessionId, generation } = await this.auth.logout(bearer)

    // Clear primary generation cookie
    const primaryCookie = getGenerationCookieName(sessionId, generation)
    res.clearCookie(primaryCookie, getClearCookieOptions())

    // Prune any other stale cookies belonging to this session
    const sessionCookies = findSessionCookies(cookies, sessionId)
    for (const c of sessionCookies) {
      if (c !== primaryCookie) {
        res.clearCookie(c, getClearCookieOptions())
      }
    }
  }
}
