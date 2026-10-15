import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Role } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class HourLogAccess {
  constructor(private readonly prisma: PrismaService) {}

  async assertPlacementAccess(placementId: number, userId: number, role: Role): Promise<void> {
    const placement = await this.prisma.placement.findUnique({ where: { id: placementId } })
    if (!placement) throw new NotFoundException('placement no encontrado')
    const allowed = role === Role.COORDINATOR || placement.studentId === userId || placement.tutorId === userId
    if (!allowed) throw new ForbiddenException('no tienes acceso a este placement')
  }

  listForPlacement(placementId: number) {
    return this.prisma.hourLog.findMany({
      where: { placementId, deletedAt: null },
      orderBy: { date: 'desc' },
    })
  }
}
