import { Module } from '@nestjs/common'
import { InstitutionTimezoneConfig } from '../common/institution-timezone.config'
import { SyncController } from './sync.controller'
import { SyncService } from './sync.service'

@Module({
  controllers: [SyncController],
  providers: [
    { provide: InstitutionTimezoneConfig, useFactory: () => new InstitutionTimezoneConfig() },
    SyncService,
  ],
})
export class SyncModule {}
