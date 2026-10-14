import { Module } from '@nestjs/common'
import { InstitutionTimezoneConfig } from '../common/institution-timezone.config'
import { HourLogController } from './hour-log.controller'
import { HourLogService } from './hour-log.service'

@Module({
  controllers: [HourLogController],
  providers: [
    { provide: InstitutionTimezoneConfig, useFactory: () => new InstitutionTimezoneConfig() },
    HourLogService,
  ],
  exports: [HourLogService],
})
export class HourLogModule {}
