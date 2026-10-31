import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, FindOptionsWhere, Repository } from 'typeorm';
import { Reading } from './entities/reading.entity';
import { CreateReadingDto } from './dto/create-reading.dto';
import { QueryReadingsDto } from './dto/query-readings.dto';
import { Device } from '../devices/device.entity';
import { AlertsService } from '../alerts/alerts.service';

export const HEARTBEAT_SENSOR_TYPE = 'heartbeat';

export interface HeartbeatAck {
  heartbeat: true;
  deviceId: string;
  lastSeenAt: Date;
}

@Injectable()
export class TelemetryService {
  constructor(
    @InjectRepository(Reading)
    private readonly readingsRepository: Repository<Reading>,
    @InjectRepository(Device)
    private readonly devicesRepository: Repository<Device>,
    private readonly alertsService: AlertsService,
  ) {}

  async ingest(dto: CreateReadingDto, device: Device): Promise<Reading | HeartbeatAck> {
    if (dto.sensor_type === HEARTBEAT_SENSOR_TYPE) {
      return this.recordHeartbeat(dto, device);
    }

    await this.readingsRepository
      .createQueryBuilder()
      .insert()
      .into(Reading)
      .values({
        readingId: dto.reading_id,
        deviceId: device.id,
        zoneId: device.zoneId,
        sensorType: dto.sensor_type,
        value: dto.value as never,
        recordedAt: new Date(dto.recorded_at),
      })
      .orIgnore()
      .execute();

    const reading = await this.readingsRepository.findOneOrFail({
      where: { readingId: dto.reading_id },
    });

    await this.alertsService.evaluateRule(reading);

    return reading;
  }

  /**
   * D-06: a heartbeat only refreshes Device.lastSeenAt. It is never stored as a Reading
   * and never reaches the alerts service. The effective time is the earlier of the
   * client-supplied recorded_at and the server clock (future timestamps are clamped),
   * and lastSeenAt never moves backwards.
   */
  private async recordHeartbeat(dto: CreateReadingDto, device: Device): Promise<HeartbeatAck> {
    const nowMs = Date.now();
    const claimedMs = new Date(dto.recorded_at).getTime();
    const effective = new Date(Number.isNaN(claimedMs) ? nowMs : Math.min(claimedMs, nowMs));

    const current = await this.devicesRepository.findOne({
      where: { id: device.id },
      select: { id: true, lastSeenAt: true },
    });
    const stored = current?.lastSeenAt ? new Date(current.lastSeenAt) : null;

    if (!stored || effective.getTime() > stored.getTime()) {
      await this.devicesRepository.update({ id: device.id }, { lastSeenAt: effective });
      return { heartbeat: true, deviceId: device.id, lastSeenAt: effective };
    }

    return { heartbeat: true, deviceId: device.id, lastSeenAt: stored };
  }

  findAll(query: QueryReadingsDto): Promise<Reading[]> {
    const where: FindOptionsWhere<Reading> = {};

    if (query.device_id) {
      where.deviceId = query.device_id;
    }
    if (query.zone_id) {
      where.zoneId = query.zone_id;
    }
    if (query.from && query.to) {
      where.recordedAt = Between(new Date(query.from), new Date(query.to));
    }

    return this.readingsRepository.find({
      where,
      order: { recordedAt: 'DESC' },
    });
  }
}
