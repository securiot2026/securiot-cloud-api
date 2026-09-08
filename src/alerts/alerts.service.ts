import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Alert } from './alert.entity';
import { Reading } from '../telemetry/entities/reading.entity';
import { QueryAlertsDto } from './dto/query-alerts.dto';

@Injectable()
export class AlertsService {
  constructor(
    @InjectRepository(Alert)
    private readonly alertsRepository: Repository<Alert>,
  ) {}

  findAllForOwner(ownerId: string, query: QueryAlertsDto): Promise<Alert[]> {
    const qb = this.alertsRepository
      .createQueryBuilder('alert')
      .leftJoin('alert.zone', 'zone')
      .where('zone.ownerId = :ownerId', { ownerId });

    if (query.zone_id) {
      qb.andWhere('alert.zoneId = :zoneId', { zoneId: query.zone_id });
    }
    if (query.device_id) {
      qb.andWhere('alert.deviceId = :deviceId', { deviceId: query.device_id });
    }
    if (query.status) {
      qb.andWhere('alert.status = :status', { status: query.status });
    }

    return qb.orderBy('alert.createdAt', 'DESC').getMany();
  }

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
