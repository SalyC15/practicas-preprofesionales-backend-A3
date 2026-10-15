import { Injectable } from '@nestjs/common'

@Injectable()
export class HourLogNotification {
  notifyTutor(tutorId: number, hourLogId: number): void {
    console.log(`[notificación] tutor ${tutorId}: nueva hora registrada #${hourLogId}`)
  }
}
