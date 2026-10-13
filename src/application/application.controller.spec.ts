import { ForbiddenException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ApplicationStatus, Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { ApplicationController } from './application.controller'
import { ApplicationService } from './application.service'

describe('ApplicationController', () => {
  let controller: ApplicationController
  let service: {
    apply: ReturnType<typeof vi.fn>
    listByOffer: ReturnType<typeof vi.fn>
    findMine: ReturnType<typeof vi.fn>
    listForStudent: ReturnType<typeof vi.fn>
    decide: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    service = {
      apply: vi.fn(),
      listByOffer: vi.fn(),
      findMine: vi.fn(),
      listForStudent: vi.fn(),
      decide: vi.fn(),
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [ApplicationController],
      providers: [{ provide: ApplicationService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile()

    controller = moduleRef.get<ApplicationController>(ApplicationController)
  })

  describe('listByOffer', () => {
    it('delega en service.listByOffer con offerId, sub y role del usuario autenticado', async () => {
      service.listByOffer.mockResolvedValue([{ id: 1 }])

      const result = await controller.listByOffer(10, {
        user: { sub: 42, role: Role.COMPANY },
      })

      expect(service.listByOffer).toHaveBeenCalledWith(10, 42, Role.COMPANY)
      expect(result).toEqual([{ id: 1 }])
    })

    it('propaga 403 Forbidden cuando el servicio deniega acceso a empresa ajena', async () => {
      service.listByOffer.mockRejectedValue(new ForbiddenException('no tienes acceso a esta oferta'))

      await expect(
        controller.listByOffer(10, {
          user: { sub: 99, role: Role.COMPANY },
        }),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('decide', () => {
    it('delega en service.decide con id, status, sub y role del usuario autenticado', async () => {
      service.decide.mockResolvedValue({ id: 5, status: ApplicationStatus.ACCEPTED })

      const result = await controller.decide(
        5,
        { status: ApplicationStatus.ACCEPTED },
        { user: { sub: 42, role: Role.COMPANY } },
      )

      expect(service.decide).toHaveBeenCalledWith(5, ApplicationStatus.ACCEPTED, 42, Role.COMPANY)
      expect(result).toEqual({ id: 5, status: ApplicationStatus.ACCEPTED })
    })

    it('propaga 403 Forbidden cuando el servicio deniega la decisión a empresa ajena', async () => {
      service.decide.mockRejectedValue(new ForbiddenException('no tienes acceso a esta oferta'))

      await expect(
        controller.decide(
          5,
          { status: ApplicationStatus.ACCEPTED },
          { user: { sub: 99, role: Role.COMPANY } },
        ),
      ).rejects.toThrow(ForbiddenException)
    })
  })
})
