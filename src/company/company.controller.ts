import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { Role } from '@prisma/client'
import { Roles } from '../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { CompanyService } from './company.service'
import { CreateCompanyDto } from './dto/create-company.dto'
import { UpdateCompanyDto } from './dto/update-company.dto'
import { VerifyCompanyDto } from './dto/verify-company.dto'

@Controller('companies')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CompanyController {
  constructor(private readonly service: CompanyService) {}

  @Get('me')
  @Roles(Role.COMPANY)
  findMine(@Req() req: { user: { sub: number } }) {
    return this.service.findMyCompany(req.user.sub)
  }

  @Patch('me')
  @Roles(Role.COMPANY)
  updateMine(@Req() req: { user: { sub: number } }, @Body() dto: UpdateCompanyDto) {
    return this.service.updateCompany(req.user.sub, dto)
  }

  @Patch(':id/verify')
  @Roles(Role.COORDINATOR)
  setVerified(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VerifyCompanyDto,
  ) {
    return this.service.setVerified(id, dto.verified)
  }

  @Get()
  findAll() {
    return this.service.findAll()
  }

  @Post()
  @Roles(Role.COORDINATOR)
  create(@Body() dto: CreateCompanyDto) {
    return this.service.create(dto)
  }
}
