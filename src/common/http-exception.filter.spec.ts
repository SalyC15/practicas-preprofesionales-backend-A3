import { HttpException, HttpStatus } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { HttpExceptionFilter, translateValidationText } from './http-exception.filter'

describe('HttpExceptionFilter', () => {
  it('shapes the response as { statusCode, message, path, timestamp }', () => {
    const json = vi.fn()
    const status = vi.fn().mockReturnValue({ json })
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url: '/api/offers' }),
      }),
    } as never

    new HttpExceptionFilter().catch(new HttpException('no encontrado', HttpStatus.NOT_FOUND), host)

    expect(status).toHaveBeenCalledWith(404)
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404, message: 'no encontrado', path: '/api/offers' }),
    )
  })

  it('translates validation error messages from class-validator into Spanish', () => {
    const rawMessages = [
      'email must be an email',
      'password must be longer than or equal to 6 characters',
    ]
    const translated = translateValidationText(rawMessages)
    expect(translated).toEqual([
      'El correo electrónico debe ser válido',
      'La contraseña debe tener al menos 6 caracteres',
    ])
  })

  it('translates general unauthorized or forbidden messages', () => {
    expect(translateValidationText('Unauthorized')).toBe('Credenciales incorrectas o sesión no autorizada')
    expect(translateValidationText('Forbidden resource')).toBe('No tienes permisos para realizar esta acción')
  })
})
