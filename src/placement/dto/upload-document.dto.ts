import { DocumentKind } from '@prisma/client'
import { IsEnum, IsInt, IsString, Min } from 'class-validator'

export class UploadDocumentDto {
  @IsEnum(DocumentKind, { message: 'El tipo de documento debe ser válido (AGREEMENT, INSURANCE, REPORT, EVIDENCE)' })
  kind!: DocumentKind

  @IsString({ message: 'El nombre del archivo debe ser un texto' })
  filename!: string

  @IsString({ message: 'El tipo MIME debe ser un texto' })
  mimeType!: string

  @IsInt({ message: 'El tamaño debe ser un número entero' })
  @Min(1, { message: 'El tamaño del archivo debe ser mayor a 0 bytes' })
  size!: number

  @IsString({ message: 'La clave de almacenamiento debe ser un texto' })
  storageKey!: string
}
