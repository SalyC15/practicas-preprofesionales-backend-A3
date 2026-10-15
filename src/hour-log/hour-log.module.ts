import { Module } from '@nestjs/common'
import { InstitutionTimezoneConfig } from '../common/institution-timezone.config'
import { HourLogController } from './hour-log.controller'
import { HourLogAccess } from './hour-log.access'
import { HourLogEntry } from './hour-log.entry'
import { HourLogExport } from './hour-log.export'
import { HourLogNotification } from './hour-log.notification'
import { HourLogReport } from './hour-log.report'
import { HourLogService } from './hour-log.service'

@Module({
  controllers: [HourLogController],
  providers: [
    { provide: InstitutionTimezoneConfig, useFactory: () => new InstitutionTimezoneConfig() },
    HourLogAccess,
    HourLogEntry,
    HourLogExport,
    HourLogNotification,
    HourLogReport,
    HourLogService,
  ],
  exports: [HourLogService],
})
export class HourLogModule {}
