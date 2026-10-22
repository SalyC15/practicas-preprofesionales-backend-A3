import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, Role } from '@prisma/client'
import { PageQueryDto, pageResult } from '../common/page-query.dto'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateCompanyDto } from './dto/create-company.dto'
import type { UpdateCompanyDto } from './dto/update-company.dto'

export interface CompanyEntity {
  id: number
  taxId: string
  name: string
  sector: string
  contactEmail: string
  phone: string | null
  address: string | null
  logoUrl: string | null
  description: string | null
  website: string | null
  verified: boolean
  createdAt: Date
}

@Injectable()
export class CompanyService {
  constructor(private readonly prisma: PrismaService) {}

  async findPage(query: PageQueryDto) {
    const search = query.search?.trim()
    const where: Prisma.CompanyWhereInput = search ? { OR: [
      { name: { contains: search, mode: 'insensitive' } },
      { sector: { contains: search, mode: 'insensitive' } },
      { taxId: { contains: search } },
    ] } : {}
    const [total, items, summary] = await this.prisma.$transaction([
      this.prisma.company.count({ where }),
      this.prisma.company.findMany({ where, orderBy: { id: 'asc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.$queryRaw<{ registered: number; verified: number; sectors: number }[]>`
        SELECT COUNT(*)::int AS registered,
               COUNT(*) FILTER (WHERE verified)::int AS verified,
               COUNT(DISTINCT sector)::int AS sectors FROM companies
      `,
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
    return { ...pageResult(items, total, query), summary: summary[0] }
  }

  async create(dto: CreateCompanyDto): Promise<CompanyEntity> {
    const existingCompany = await this.prisma.company.findUnique({
      where: { taxId: dto.taxId },
    })
    if (existingCompany) {
      throw new BadRequestException('Ya existe una empresa registrada con ese RUC / Identificación')
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.contactEmail },
    })
    if (existingUser) {
      throw new BadRequestException('Ya existe un usuario registrado con ese correo de contacto')
    }

    const passwordToUse = dto.password?.trim() || 'yura1234'
    const hashedPassword = await bcrypt.hash(passwordToUse, 10)

    const company = await this.prisma.company.create({
      data: {
        taxId: dto.taxId,
        name: dto.name,
        sector: dto.sector,
        contactEmail: dto.contactEmail,
        verified: dto.verified ?? false,
      },
    })

    // Creamos automáticamente las credenciales de acceso para la empresa
    await this.prisma.user.create({
      data: {
        email: dto.contactEmail,
        password: hashedPassword,
        fullName: dto.name,
        role: Role.COMPANY,
        companyId: company.id,
      },
    })

    const list = await this.prisma.$queryRaw<CompanyEntity[]>`
      SELECT id, "taxId", name, sector, "contactEmail", phone, address, "logoUrl", description, website, verified, "createdAt"
      FROM companies
      WHERE id = ${company.id}
      LIMIT 1
    `
    return list[0]
  }

  async setVerified(companyId: number, verified: boolean): Promise<CompanyEntity> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } })
    if (!company) {
      throw new NotFoundException('Empresa no encontrada')
    }

    await this.prisma.$executeRaw`
      UPDATE companies
      SET verified = ${verified}
      WHERE id = ${companyId}
    `

    const list = await this.prisma.$queryRaw<CompanyEntity[]>`
      SELECT id, "taxId", name, sector, "contactEmail", phone, address, "logoUrl", description, website, verified, "createdAt"
      FROM companies
      WHERE id = ${companyId}
      LIMIT 1
    `
    return list[0]
  }

  findAll(): Promise<CompanyEntity[]> {
    return this.prisma.$queryRaw<CompanyEntity[]>`
      SELECT id, "taxId", name, sector, "contactEmail", phone, address, "logoUrl", description, website, verified, "createdAt"
      FROM companies
      ORDER BY id ASC
    `
  }

  async findMyCompany(userId: number): Promise<CompanyEntity> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    })
    if (!user?.companyId) {
      throw new NotFoundException('El usuario no tiene una empresa asociada')
    }

    const list = await this.prisma.$queryRaw<CompanyEntity[]>`
      SELECT id, "taxId", name, sector, "contactEmail", phone, address, "logoUrl", description, website, verified, "createdAt"
      FROM companies
      WHERE id = ${user.companyId}
      LIMIT 1
    `
    if (!list.length) {
      throw new NotFoundException('Empresa no encontrada')
    }
    return list[0]
  }

  async updateCompany(userId: number, dto: UpdateCompanyDto): Promise<CompanyEntity> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    })
    if (!user?.companyId) {
      throw new NotFoundException('El usuario no tiene una empresa asociada')
    }

    const currentList = await this.prisma.$queryRaw<CompanyEntity[]>`
      SELECT id, "taxId", name, sector, "contactEmail", phone, address, "logoUrl", description, website, verified, "createdAt"
      FROM companies
      WHERE id = ${user.companyId}
      LIMIT 1
    `
    if (!currentList.length) {
      throw new NotFoundException('Empresa no encontrada')
    }
    const current = currentList[0]

    const name = dto.name !== undefined ? dto.name : current.name
    const sector = dto.sector !== undefined ? dto.sector : current.sector
    const contactEmail = dto.contactEmail !== undefined ? dto.contactEmail : current.contactEmail
    const phone = dto.phone !== undefined ? dto.phone : current.phone
    const address = dto.address !== undefined ? dto.address : current.address
    const logoUrl = dto.logoUrl !== undefined ? dto.logoUrl : current.logoUrl
    const description = dto.description !== undefined ? dto.description : current.description
    const website = dto.website !== undefined ? dto.website : current.website

    await this.prisma.$executeRaw`
      UPDATE companies
      SET
        name = ${name},
        sector = ${sector},
        "contactEmail" = ${contactEmail},
        phone = ${phone},
        address = ${address},
        "logoUrl" = ${logoUrl},
        description = ${description},
        website = ${website}
      WHERE id = ${user.companyId}
    `

    const updated = await this.prisma.$queryRaw<CompanyEntity[]>`
      SELECT id, "taxId", name, sector, "contactEmail", phone, address, "logoUrl", description, website, verified, "createdAt"
      FROM companies
      WHERE id = ${user.companyId}
      LIMIT 1
    `
    return updated[0]
  }
}
