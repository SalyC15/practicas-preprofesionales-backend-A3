import { ApplicationStatus } from '@prisma/client'
import { IsIn } from 'class-validator'

export class DecideApplicationDto {
  @IsIn([ApplicationStatus.INTERVIEW, ApplicationStatus.ACCEPTED, ApplicationStatus.REJECTED], {
    message: 'El estado debe ser INTERVIEW, ACCEPTED o REJECTED',
  })
  status!: ApplicationStatus
}
