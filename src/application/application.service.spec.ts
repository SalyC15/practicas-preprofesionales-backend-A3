import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { ApplicationStatus, Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApplicationService } from './application.service'

const prisma = {
  application: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  offer: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
}
const offers = { acceptedCount: vi.fn() }

describe('ApplicationService', () => {
  let service: ApplicationService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new ApplicationService(prisma as never, offers as never)
  })

  it('accepts an application when there are seats left', async () => {
    prisma.application.findUnique.mockResolvedValue({ id: 7, offerId: 1, status: 'SUBMITTED' })
    prisma.offer.findUnique.mockResolvedValue({ id: 1, seats: 3, status: 'PUBLISHED' })
    offers.acceptedCount.mockResolvedValue(2)
    prisma.application.update.mockImplementation(({ data }) => Promise.resolve({ id: 7, ...data }))

    const result = await service.decide(7, 'ACCEPTED' as never)

    expect(result.status).toBe('ACCEPTED')
    expect(result.decidedAt).toBeInstanceOf(Date)
  })

  it('rejects accepting when the offer is already full', async () => {
    prisma.application.findUnique.mockResolvedValue({ id: 7, offerId: 1, status: 'SUBMITTED' })
    prisma.offer.findUnique.mockResolvedValue({ id: 1, seats: 3, status: 'PUBLISHED' })
    offers.acceptedCount.mockResolvedValue(3)

    await expect(service.decide(7, 'ACCEPTED' as never)).rejects.toThrow(BadRequestException)
  })

  it('lists applications of an offer with their student', async () => {
    prisma.application.findMany.mockResolvedValue([
      { id: 1, studentId: 10, status: 'SUBMITTED' },
      { id: 2, studentId: 11, status: 'SUBMITTED' },
    ])
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 10, fullName: 'Estudiante 10' })
      .mockResolvedValueOnce({ id: 11, fullName: 'Estudiante 11' })

    const result = await service.listByOffer(1)

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ id: 1, student: { fullName: 'Estudiante 10' } })
  })

  describe('E3-07: assertOfferAccess', () => {
    it('permite acceso total a coordinación sin consultar companyId del usuario', async () => {
      prisma.offer.findUnique.mockResolvedValue({ id: 10, companyId: 5 })

      await expect(service.assertOfferAccess(10, 999, Role.COORDINATOR)).resolves.toBeUndefined()
      expect(prisma.user.findUnique).not.toHaveBeenCalled()
    })

    it('permite acceso al usuario COMPANY cuya companyId coincide con la de la oferta', async () => {
      prisma.offer.findUnique.mockResolvedValue({ id: 10, companyId: 5 })
      prisma.user.findUnique.mockResolvedValue({ companyId: 5 })

      await expect(service.assertOfferAccess(10, 42, Role.COMPANY)).resolves.toBeUndefined()
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 42 },
        select: { companyId: true },
      })
    })

    it('deniega acceso con 403 Forbidden a usuario COMPANY cuya companyId es distinta a la de la oferta', async () => {
      prisma.offer.findUnique.mockResolvedValue({ id: 10, companyId: 5 })
      prisma.user.findUnique.mockResolvedValue({ companyId: 99 })

      await expect(service.assertOfferAccess(10, 42, Role.COMPANY)).rejects.toThrow(ForbiddenException)
    })

    it('deniega acceso con 403 Forbidden si el usuario COMPANY no tiene companyId asociada', async () => {
      prisma.offer.findUnique.mockResolvedValue({ id: 10, companyId: 5 })
      prisma.user.findUnique.mockResolvedValue({ companyId: null })

      await expect(service.assertOfferAccess(10, 42, Role.COMPANY)).rejects.toThrow(ForbiddenException)
    })

    it('deniega acceso con 403 Forbidden a roles no autorizados (ej. STUDENT)', async () => {
      prisma.offer.findUnique.mockResolvedValue({ id: 10, companyId: 5 })

      await expect(service.assertOfferAccess(10, 42, Role.STUDENT)).rejects.toThrow(ForbiddenException)
      expect(prisma.user.findUnique).not.toHaveBeenCalled()
    })

    it('lanza 404 NotFoundException si la oferta no existe', async () => {
      prisma.offer.findUnique.mockResolvedValue(null)

      await expect(service.assertOfferAccess(999, 42, Role.COMPANY)).rejects.toThrow(NotFoundException)
    })
  })

  describe('E3-07: listByOffer con autorización', () => {
    it('permite listar postulaciones a la empresa dueña de la oferta', async () => {
      prisma.offer.findUnique.mockResolvedValue({ id: 10, companyId: 5 })
      prisma.user.findUnique
        .mockResolvedValueOnce({ companyId: 5 }) // assertOfferAccess
        .mockResolvedValueOnce({ id: 101, email: 'est1@uni.edu', fullName: 'Estudiante 1' }) // estudiante
      prisma.application.findMany.mockResolvedValue([
        { id: 1, offerId: 10, studentId: 101, status: ApplicationStatus.SUBMITTED },
      ])

      const result = await service.listByOffer(10, 42, Role.COMPANY)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe(1)
    })

    it('permite listar postulaciones a coordinación', async () => {
      prisma.offer.findUnique.mockResolvedValue({ id: 10, companyId: 5 })
      prisma.user.findUnique.mockResolvedValueOnce({ id: 101, email: 'est1@uni.edu', fullName: 'Estudiante 1' })
      prisma.application.findMany.mockResolvedValue([
        { id: 1, offerId: 10, studentId: 101, status: ApplicationStatus.SUBMITTED },
      ])

      const result = await service.listByOffer(10, 999, Role.COORDINATOR)

      expect(result).toHaveLength(1)
    })

    it('deniega listar postulaciones con 403 Forbidden a una empresa ajena', async () => {
      prisma.offer.findUnique.mockResolvedValue({ id: 10, companyId: 5 })
      prisma.user.findUnique.mockResolvedValue({ companyId: 99 })

      await expect(service.listByOffer(10, 42, Role.COMPANY)).rejects.toThrow(ForbiddenException)
      expect(prisma.application.findMany).not.toHaveBeenCalled()
    })
  })

  describe('E3-07: decide con autorización', () => {
    it('permite decidir postulación a la empresa dueña de la oferta', async () => {
      prisma.application.findUnique.mockResolvedValue({ id: 1, offerId: 10, status: ApplicationStatus.SUBMITTED })
      prisma.offer.findUnique.mockResolvedValue({ id: 10, companyId: 5, seats: 3, status: 'PUBLISHED' })
      prisma.user.findUnique.mockResolvedValue({ companyId: 5 })
      offers.acceptedCount.mockResolvedValue(1)
      prisma.application.update.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }))

      const result = await service.decide(1, ApplicationStatus.ACCEPTED, 42, Role.COMPANY)

      expect(result.status).toBe(ApplicationStatus.ACCEPTED)
      expect(prisma.application.update).toHaveBeenCalled()
    })

    it('permite decidir postulación a coordinación', async () => {
      prisma.application.findUnique.mockResolvedValue({ id: 1, offerId: 10, status: ApplicationStatus.SUBMITTED })
      prisma.offer.findUnique.mockResolvedValue({ id: 10, companyId: 5, seats: 3, status: 'PUBLISHED' })
      offers.acceptedCount.mockResolvedValue(1)
      prisma.application.update.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }))

      const result = await service.decide(1, ApplicationStatus.ACCEPTED, 999, Role.COORDINATOR)

      expect(result.status).toBe(ApplicationStatus.ACCEPTED)
      expect(prisma.application.update).toHaveBeenCalled()
    })

    it('deniega decidir postulación con 403 Forbidden a una empresa ajena y no actualiza en BD', async () => {
      prisma.application.findUnique.mockResolvedValue({ id: 1, offerId: 10, status: ApplicationStatus.SUBMITTED })
      prisma.offer.findUnique.mockResolvedValue({ id: 10, companyId: 5, seats: 3, status: 'PUBLISHED' })
      prisma.user.findUnique.mockResolvedValue({ companyId: 99 })

      await expect(
        service.decide(1, ApplicationStatus.ACCEPTED, 42, Role.COMPANY),
      ).rejects.toThrow(ForbiddenException)

      expect(prisma.application.update).not.toHaveBeenCalled()
    })
  })
})
