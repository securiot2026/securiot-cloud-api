import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Alert } from './alert.entity';
import { Reading } from '../telemetry/entities/reading.entity';

@Injectable()
export class AlertsService {
  constructor(
    @InjectRepository(Alert)
    private readonly alertsRepository: Repository<Alert>,
  ) {}

  async evaluateRule(reading: Reading): Promise<void> {
    const isDoorOpen =
      reading.sensorType === 'door_contact' &&
      (reading.value === 'open' || (reading.value as { state?: unknown })?.state === 'open');

    if (!isDoorOpen) {
      return;
    }

    await this.alertsRepository
      .createQueryBuilder()
      .insert()
      .into(Alert)
      .values({
        zoneId: reading.zoneId,
        deviceId: reading.deviceId,
        readingId: reading.id,
        ruleType: 'door_contact_open',
        severity: 'medium',
        status: 'active',
        message: 'Door contact sensor reported open',
      })
      .orIgnore()
      .execute();
  }
}
