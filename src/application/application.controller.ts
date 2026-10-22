import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { PageQueryDto } from '../common/page-query.dto'
import { Role } from '@prisma/client'
import { Roles } from '../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { ApplicationService } from './application.service'
import { CreateApplicationDto } from './dto/create-application.dto'
import { DecideApplicationDto } from './dto/decide-application.dto'

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ApplicationController {
  constructor(private readonly service: ApplicationService) {}

  @Get('applications/me/offer/:offerId')
  @Roles(Role.STUDENT)
  mineForOffer(@Param('offerId', ParseIntPipe) offerId: number, @Req() req: { user: { sub: number } }) {
    return this.service.findMineForOffer(req.user.sub, offerId)
  }

  @Get('offers/:offerId/applications/paged')
  @Roles(Role.COMPANY, Role.COORDINATOR)
  listPage(@Param('offerId', ParseIntPipe) offerId: number, @Query() query: PageQueryDto,
    @Req() req: { user: { sub: number; role: Role } }) {
    return this.service.listPage(query, { offerId }, req.user.sub, req.user.role)
  }

  @Get('applications/me/paged')
  @Roles(Role.STUDENT)
  minePage(@Query() query: PageQueryDto, @Req() req: { user: { sub: number; role: Role } }) {
    return this.service.listPage(query, { studentId: req.user.sub }, req.user.sub, req.user.role)
  }

  @Post('applications')
  @Roles(Role.STUDENT)
  apply(@Body() dto: CreateApplicationDto, @Req() req: { user: { sub: number } }) {
    return this.service.apply(dto.offerId, req.user.sub, dto.motivation)
  }

  @Get('offers/:offerId/applications')
  @Roles(Role.COMPANY, Role.COORDINATOR)
  listByOffer(
    @Param('offerId', ParseIntPipe) offerId: number,
    @Req() req: { user: { sub: number; role: Role } },
  ) {
    return this.service.listByOffer(offerId, req.user.sub, req.user.role)
  }

  @Get('applications/me')
  @Roles(Role.STUDENT)
  findMine(@Req() req: { user: { sub: number } }) {
    return this.service.listForStudent(req.user.sub)
  }

  @Patch('applications/:id/decide')
  @Roles(Role.COMPANY, Role.COORDINATOR)
  decide(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecideApplicationDto,
    @Req() req: { user: { sub: number; role: Role } },
  ) {
    return this.service.decide(id, dto.status, req.user.sub, req.user.role)
  }
}
