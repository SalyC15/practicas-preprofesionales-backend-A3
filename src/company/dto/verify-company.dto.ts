import { IsBoolean } from 'class-validator'

export class VerifyCompanyDto {
  @IsBoolean({ message: 'El estado de verificación debe ser verdadero o falso' })
  verified!: boolean
}
