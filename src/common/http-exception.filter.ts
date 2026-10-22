import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common'

export function translateValidationText(msg: unknown): unknown {
  if (Array.isArray(msg)) {
    return msg.map(translateValidationText)
  }
  if (typeof msg !== 'string') return msg

  let text = msg
  if (/email must be an email/i.test(text)) {
    text = text.replace(/email must be an email/gi, 'El correo electrónico debe ser válido')
  }
  if (/password must be longer than or equal to (\d+) characters/i.test(text)) {
    text = text.replace(/password must be longer than or equal to (\d+) characters/gi, 'La contraseña debe tener al menos $1 caracteres')
  }
  if (/password should not be empty/i.test(text)) {
    text = text.replace(/password should not be empty/gi, 'La contraseña no puede estar vacía')
  }
  if (/email should not be empty/i.test(text)) {
    text = text.replace(/email should not be empty/gi, 'El correo electrónico no puede estar vacío')
  }
  if (/([a-zA-Z0-9_]+) must be an email/i.test(text)) {
    text = text.replace(/([a-zA-Z0-9_]+) must be an email/gi, 'El campo $1 debe ser un correo electrónico válido')
  }
  if (/([a-zA-Z0-9_]+) must be longer than or equal to (\d+) characters/i.test(text)) {
    text = text.replace(/([a-zA-Z0-9_]+) must be longer than or equal to (\d+) characters/gi, 'El campo $1 debe tener al menos $2 caracteres')
  }
  if (/([a-zA-Z0-9_]+) must be shorter than or equal to (\d+) characters/i.test(text)) {
    text = text.replace(/([a-zA-Z0-9_]+) must be shorter than or equal to (\d+) characters/gi, 'El campo $1 debe tener como máximo $2 caracteres')
  }
  if (/([a-zA-Z0-9_]+) should not be empty/i.test(text)) {
    text = text.replace(/([a-zA-Z0-9_]+) should not be empty/gi, 'El campo $1 no debe estar vacío')
  }
  if (/([a-zA-Z0-9_]+) must be a string/i.test(text)) {
    text = text.replace(/([a-zA-Z0-9_]+) must be a string/gi, 'El campo $1 debe ser un texto válido')
  }
  if (/([a-zA-Z0-9_]+) must be an integer number/i.test(text)) {
    text = text.replace(/([a-zA-Z0-9_]+) must be an integer number/gi, 'El campo $1 debe ser un número entero')
  }
  if (/([a-zA-Z0-9_]+) must not be less than (\d+)/i.test(text)) {
    text = text.replace(/([a-zA-Z0-9_]+) must not be less than (\d+)/gi, 'El campo $1 no puede ser menor a $2')
  }
  if (/([a-zA-Z0-9_]+) must not be greater than (\d+)/i.test(text)) {
    text = text.replace(/([a-zA-Z0-9_]+) must not be greater than (\d+)/gi, 'El campo $1 no puede ser mayor a $2')
  }
  if (text === 'Unauthorized') {
    text = 'Credenciales incorrectas o sesión no autorizada'
  }
  if (text === 'Forbidden resource') {
    text = 'No tienes permisos para realizar esta acción'
  }
  if (text === 'Internal server error') {
    text = 'Error interno del servidor. Intenta de nuevo más tarde.'
  }
  return text
}

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse()
    const request = ctx.getRequest()
    const status = exception.getStatus()
    const payload = exception.getResponse()

    const rawMessage = typeof payload === 'string' ? payload : (payload as { message?: unknown }).message

    response.status(status).json({
      statusCode: status,
      message: translateValidationText(rawMessage),
      path: request.url,
      timestamp: new Date().toISOString(),
    })
  }
}
