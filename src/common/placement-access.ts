import { Role } from '@prisma/client'
import type { Placement } from '@prisma/client'
import type { PrismaService } from '../prisma/prisma.service'

/** Read access follows the caller's role and relationship to the placement. */
export async function canReadPlacement(
  prisma: Pick<PrismaService, 'user'>,
  placement: Pick<Placement, 'studentId' | 'tutorId' | 'companyId'>,
  userId: number,
  role: Role,
): Promise<boolean> {
  if (role === Role.COORDINATOR) return true
  if (role === Role.STUDENT) return placement.studentId === userId
  if (role === Role.TUTOR) return placement.tutorId === userId
  if (role !== Role.COMPANY) return false

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { companyId: true },
  })
  return user?.companyId != null && user.companyId === placement.companyId
}
