import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { ApplicationStatus, OfferStatus, Prisma } from '@prisma/client'
import { PageQueryDto, pageResult } from '../common/page-query.dto'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateOfferDto } from './dto/create-offer.dto'

@Injectable()
export class OfferService {
  constructor(private readonly prisma: PrismaService) {}

  async findMyPage(userId: number, query: PageQueryDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { companyId: true } })
    if (!user?.companyId) throw new NotFoundException('el usuario no tiene una empresa asociada')
    const where = { companyId: user.companyId }
    const [total, offers, published, drafts, applications] = await this.prisma.$transaction([
      this.prisma.offer.count({ where }),
      this.prisma.offer.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: { company: true, _count: { select: { applications: true } } } }),
      this.prisma.offer.count({ where: { ...where, status: OfferStatus.PUBLISHED } }),
      this.prisma.offer.count({ where: { ...where, status: OfferStatus.DRAFT } }),
      this.prisma.application.count({ where: { offer: where } }),
    ])
    const accepted = await this.prisma.application.groupBy({ by: ['offerId'],
      where: { offerId: { in: offers.map((offer) => offer.id) }, status: ApplicationStatus.ACCEPTED }, _count: true })
    const acceptedByOffer = new Map(accepted.map((row) => [row.offerId, row._count]))
    const items = offers.map(({ _count, ...offer }) => ({ ...offer, applications: [], applicationCount: _count.applications, acceptedCount: acceptedByOffer.get(offer.id) ?? 0 }))
    return { ...pageResult(items, total, query), summary: { published, drafts, applications } }
  }

  async findPage(query: PageQueryDto) {
    const search = query.search?.trim()
    const where: Prisma.OfferWhereInput = {
      status: OfferStatus.PUBLISHED,
      ...(query.modality ? { modality: query.modality } : {}),
      ...(search ? { OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { company: { name: { contains: search, mode: 'insensitive' } } },
      ] } : {}),
    }
    const [total, items, modalities] = await this.prisma.$transaction([
      this.prisma.offer.count({ where }),
      this.prisma.offer.findMany({ where, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: { company: true } }),
      this.prisma.offer.groupBy({ by: ['modality'], where: { status: OfferStatus.PUBLISHED }, orderBy: { modality: 'asc' } }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
    return { ...pageResult(items, total, query), modalities: modalities.map((row) => row.modality) }
  }

  create(dto: CreateOfferDto) {
    return this.prisma.offer.create({ data: { ...dto, status: OfferStatus.DRAFT } })
  }

  findAll() {
    return this.prisma.offer.findMany({
      where: { status: OfferStatus.PUBLISHED },
      orderBy: { publishedAt: 'desc' },
      include: { company: true },
    })
  }

  async findOne(id: number) {
    const offer = await this.prisma.offer.findUnique({ where: { id }, include: { company: true } })
    if (!offer) throw new NotFoundException('oferta no encontrada')
    return offer
  }

  // Ofertas de la empresa del usuario autenticado, en cualquier estado —
  // a diferencia de findAll() (solo PUBLISHED, para el catálogo del estudiante).
  // Incluye el estado de las postulaciones para que la empresa vea cupos
  // ocupados sin que el front tenga que pedir una lista aparte por oferta.
  async findAllForCompanyUser(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { companyId: true } })
    if (!user?.companyId) throw new NotFoundException('el usuario no tiene una empresa asociada')
    return this.prisma.offer.findMany({
      where: { companyId: user.companyId },
      orderBy: { createdAt: 'desc' },
      include: { company: true, applications: { select: { status: true } } },
    })
  }

  async publish(id: number) {
    const offer = await this.prisma.offer.findUnique({ where: { id } })
    if (!offer) throw new NotFoundException('oferta no encontrada')
    if (offer.status !== OfferStatus.DRAFT) {
      throw new BadRequestException('solo se publican ofertas en DRAFT')
    }
    return this.prisma.offer.update({
      where: { id },
      data: { status: OfferStatus.PUBLISHED, publishedAt: new Date() },
    })
  }

  async close(id: number) {
    const offer = await this.prisma.offer.findUnique({ where: { id } })
    if (!offer) throw new NotFoundException('oferta no encontrada')
    if (offer.status !== OfferStatus.PUBLISHED) {
      throw new BadRequestException('solo se cierran ofertas publicadas')
    }
    return this.prisma.offer.update({ where: { id }, data: { status: OfferStatus.CLOSED } })
  }

  // Cuenta las postulaciones ya aceptadas para una oferta.
  acceptedCount(offerId: number): Promise<number> {
    return this.prisma.application.count({
      where: { offerId, status: ApplicationStatus.ACCEPTED },
    })
  }
}
