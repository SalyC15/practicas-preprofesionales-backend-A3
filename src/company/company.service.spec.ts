import { NotFoundException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { CompanyService } from './company.service'

describe('CompanyService', () => {
  const mockPrisma = {
    company: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  }

  const service = new CompanyService(mockPrisma as never)

  it('throws NotFoundException if user has no associated company', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ companyId: null })
    await expect(service.findMyCompany(10)).rejects.toThrow(NotFoundException)
  })

  it('returns company profile if user has associated company', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ companyId: 5 })
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        id: 5,
        taxId: '1234567890001',
        name: 'Tech Corp',
        sector: 'Tecnología',
        contactEmail: 'contacto@techcorp.com',
        phone: '0999999999',
        address: 'Av. Siempre Viva 123',
        logoUrl: 'https://example.com/logo.png',
        description: 'Empresa de software',
        website: 'https://techcorp.com',
        verified: true,
        createdAt: new Date(),
      },
    ])

    const company = await service.findMyCompany(10)
    expect(company.name).toBe('Tech Corp')
    expect(company.phone).toBe('0999999999')
    expect(company.logoUrl).toBe('https://example.com/logo.png')
  })

  it('updates company profile and returns updated record', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ companyId: 5 })
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 5,
          name: 'Tech Corp',
          sector: 'Tecnología',
          contactEmail: 'old@techcorp.com',
          phone: null,
          address: null,
          logoUrl: null,
          description: null,
          website: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 5,
          name: 'Tech Corp',
          sector: 'Tecnología',
          contactEmail: 'new@techcorp.com',
          phone: '0987654321',
          address: 'Calle Nueva 456',
          logoUrl: 'https://techcorp.com/logo.svg',
          description: 'Innovación en software',
          website: 'https://techcorp.com',
          verified: true,
          createdAt: new Date(),
        },
      ])
    mockPrisma.$executeRaw.mockResolvedValueOnce(1)

    const updated = await service.updateCompany(10, {
      contactEmail: 'new@techcorp.com',
      phone: '0987654321',
      address: 'Calle Nueva 456',
      logoUrl: 'https://techcorp.com/logo.svg',
      description: 'Innovación en software',
      website: 'https://techcorp.com',
    })

    expect(updated.contactEmail).toBe('new@techcorp.com')
    expect(updated.phone).toBe('0987654321')
    expect(mockPrisma.$executeRaw).toHaveBeenCalled()
  })

  it('creates company and also creates associated user credentials with role COMPANY', async () => {
    mockPrisma.company.findUnique.mockResolvedValueOnce(null)
    mockPrisma.user.findUnique.mockResolvedValueOnce(null)
    mockPrisma.company.create.mockResolvedValueOnce({
      id: 8,
      taxId: '1790012345001',
      name: 'Nueva Empresa',
      sector: 'Finanzas',
      contactEmail: 'admin@nueva.com',
      verified: false,
    })
    mockPrisma.user.create.mockResolvedValueOnce({ id: 25 })
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        id: 8,
        taxId: '1790012345001',
        name: 'Nueva Empresa',
        sector: 'Finanzas',
        contactEmail: 'admin@nueva.com',
        phone: null,
        address: null,
        logoUrl: null,
        description: null,
        website: null,
        verified: false,
        createdAt: new Date(),
      },
    ])

    const created = await service.create({
      taxId: '1790012345001',
      name: 'Nueva Empresa',
      sector: 'Finanzas',
      contactEmail: 'admin@nueva.com',
      password: 'passwordSegura123',
    })

    expect(mockPrisma.company.create).toHaveBeenCalled()
    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'admin@nueva.com',
          role: 'COMPANY',
          companyId: 8,
        }),
      }),
    )
    expect(created.name).toBe('Nueva Empresa')
  })

  it('updates verified state when setVerified is called', async () => {
    mockPrisma.company.findUnique.mockResolvedValueOnce({ id: 8 })
    mockPrisma.$executeRaw.mockResolvedValueOnce(1)
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        id: 8,
        taxId: '1790012345001',
        name: 'Nueva Empresa',
        sector: 'Finanzas',
        contactEmail: 'admin@nueva.com',
        phone: null,
        address: null,
        logoUrl: null,
        description: null,
        website: null,
        verified: true,
        createdAt: new Date(),
      },
    ])

    const verifiedCompany = await service.setVerified(8, true)
    expect(mockPrisma.$executeRaw).toHaveBeenCalled()
    expect(verifiedCompany.verified).toBe(true)
  })
})
