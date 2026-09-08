import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, FindOptionsWhere, Repository } from 'typeorm';
import { Reading } from './entities/reading.entity';
import { CreateReadingDto } from './dto/create-reading.dto';
import { QueryReadingsDto } from './dto/query-readings.dto';
import { Device } from '../devices/device.entity';
import { AlertsService } from '../alerts/alerts.service';

@Injectable()
export class TelemetryService {
  constructor(
    @InjectRepository(Reading)
    private readonly readingsRepository: Repository<Reading>,
    private readonly alertsService: AlertsService,
  ) {}

  async ingest(dto: CreateReadingDto, device: Device): Promise<Reading> {
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
