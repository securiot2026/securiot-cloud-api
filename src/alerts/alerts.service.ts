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

  // RULE-12: the old hardcoded door_contact_open check has been retired —
  // the Edge rules engine (Phase 8) now decides when a door lock fires, and
  // relays a generic "rule_alert" Reading carrying which rule triggered and
  // its severity/message. This method's only job is to turn that one
  // generic Reading shape into an Alert row; it no longer contains
  // rule-specific logic of its own (no duplicated engine on this side).
  async evaluateRule(reading: Reading): Promise<void> {
    if (reading.sensorType !== 'rule_alert') {
      return;
    }

    const payload = this.parseRuleAlertValue(reading.value);
    if (!payload) {
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
        ruleType: payload.ruleName,
        severity: payload.severity,
        status: 'active',
        message: payload.message,
      })
      .orIgnore()
      .execute();
  }

  private parseRuleAlertValue(
    value: unknown,
  ): { ruleName: string; severity: string; message: string } | null {
    let parsed: unknown = value;
    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value);
      } catch {
        return null;
      }
    }

    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    if (typeof record.rule_name !== 'string' || typeof record.severity !== 'string') {
      return null;
    }

    return {
      ruleName: record.rule_name,
      severity: record.severity,
      message: typeof record.message === 'string' ? record.message : `Rule '${record.rule_name}' triggered`,
    };
  }
}
