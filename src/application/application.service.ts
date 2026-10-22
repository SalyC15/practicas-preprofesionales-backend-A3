import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { ApplicationStatus, Role } from '@prisma/client'
import { OfferService } from '../offer/offer.service'
import { PrismaService } from '../prisma/prisma.service'
import { PageQueryDto, pageResult } from '../common/page-query.dto'

@Injectable()
export class ApplicationService {
  findMineForOffer(studentId: number, offerId: number) {
    return this.prisma.application.findFirst({ where: { studentId, offerId }, include: { offer: { include: { company: true } } } })
  }
  async listPage(query: PageQueryDto, scope: { studentId?: number; offerId?: number }, userId: number, role: Role) {
    if (scope.offerId !== undefined) await this.assertOfferAccess(scope.offerId, userId, role)
    const where = scope
    const [total, items, accepted] = await this.prisma.$transaction([
      this.prisma.application.count({ where }),
      this.prisma.application.findMany({ where, skip: (query.page - 1) * query.pageSize, take: query.pageSize,
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        include: { student: { select: { id: true, fullName: true, email: true } }, offer: { include: { company: true } } } }),
      this.prisma.application.count({ where: { ...where, status: ApplicationStatus.ACCEPTED } }),
    ])
    return { ...pageResult(items, total, query), accepted }
  }
  constructor(
    private readonly prisma: PrismaService,
    private readonly offers: OfferService,
  ) {}

  apply(offerId: number, studentId: number, motivation: string) {
    return this.prisma.application.create({
      data: { offerId, studentId, motivation, status: ApplicationStatus.SUBMITTED },
    })
  }

  // Postulaciones del propio estudiante, con la oferta y la empresa incluidas
  // para que la pantalla no tenga que resolverlas con llamadas aparte.
  listForStudent(studentId: number) {
    return this.prisma.application.findMany({
      where: { studentId },
      orderBy: { submittedAt: 'desc' },
      include: { offer: { include: { company: true } } },
    })
  }

  /**
   * E3-07: Verifica que quien consulta o decide postulaciones de una oferta sea
   * la empresa dueña de la oferta o un coordinador.
   */
  async assertOfferAccess(offerId: number, userId: number, role: Role): Promise<void> {
    const offer = await this.prisma.offer.findUnique({ where: { id: offerId } })
    if (!offer) throw new NotFoundException('oferta no encontrada')

    if (role === Role.COORDINATOR) return

    if (role !== Role.COMPANY) {
      throw new ForbiddenException('no tienes acceso a esta oferta')
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    })

    const allowed = user?.companyId !== null && user?.companyId !== undefined && user.companyId === offer.companyId
    if (!allowed) {
      throw new ForbiddenException('no tienes acceso a esta oferta')
    }
  }

  // E2-03: carga los estudiantes en conjunto; el SQL no crece por candidato.
  async listByOffer(offerId: number, userId?: number, role?: Role) {
    if (userId !== undefined && role !== undefined) {
      await this.assertOfferAccess(offerId, userId, role)
    }

    return this.prisma.application.findMany({
      where: { offerId },
      include: {
        student: { select: { id: true, email: true, fullName: true } },
      },
    })
  }

  async decide(id: number, status: ApplicationStatus, userId?: number, role?: Role) {
    return this.prisma.$transaction(async (tx) => {
      const application = await tx.application.findUnique({ where: { id } })
      if (!application) throw new NotFoundException('postulación no encontrada')

      if (userId !== undefined && role !== undefined) {
        await this.assertOfferAccess(application.offerId, userId, role)
      }

      if (application.status !== ApplicationStatus.SUBMITTED && application.status !== ApplicationStatus.INTERVIEW) {
        throw new BadRequestException('la postulación ya fue decidida')
      }

      if (status === ApplicationStatus.ACCEPTED) {
        const lockedOffers = await tx.$queryRaw<Array<{ id: number; seats: number }>>`
          SELECT id, seats FROM "offers" WHERE id = ${application.offerId} FOR UPDATE
        `
        const offer = lockedOffers[0]
        if (!offer) throw new NotFoundException('oferta no encontrada')

        const accepted = await tx.application.count({
          where: { offerId: application.offerId, status: ApplicationStatus.ACCEPTED },
        })
        if (accepted >= offer.seats) throw new BadRequestException('la oferta ya no tiene cupos')
      }

      return tx.application.update({
        where: { id },
        data: { status, decidedAt: new Date() },
      })
    })
  }
}
