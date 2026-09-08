import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Device } from './device.entity';
import { Zone } from '../zones/zone.entity';
import { Reading } from '../telemetry/entities/reading.entity';
import { CreateDeviceDto } from './dto/create-device.dto';
import { DeviceCreatedResponseDto, DeviceResponseDto, DeviceStatusResponseDto } from './dto/device-response.dto';

const DEFAULT_ONLINE_WINDOW_SECONDS = 300;

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(Device)
    private readonly devicesRepository: Repository<Device>,
    @InjectRepository(Zone)
    private readonly zonesRepository: Repository<Zone>,
    @InjectRepository(Reading)
    private readonly readingsRepository: Repository<Reading>,
  ) {}

  async create(dto: CreateDeviceDto, ownerId: string): Promise<DeviceCreatedResponseDto> {
    const zone = await this.zonesRepository.findOne({ where: { id: dto.zoneId, ownerId } });
    if (!zone) {
      throw new NotFoundException('Zone not found');
    }

    const apiKey = crypto.randomBytes(24).toString('hex');
    const device = await this.devicesRepository.save(
      this.devicesRepository.create({ name: dto.name, zoneId: dto.zoneId, apiKey }),
    );

    return this.toCreatedResponse(device);
  }

  async findAllForOwner(ownerId: string, zoneId?: string): Promise<DeviceResponseDto[]> {
    const query = this.devicesRepository
      .createQueryBuilder('device')
      .leftJoin('device.zone', 'zone')
      .where('zone.ownerId = :ownerId', { ownerId });

    if (zoneId) {
      query.andWhere('device.zoneId = :zoneId', { zoneId });
    }

    const devices = await query.getMany();
    return devices.map((device) => this.toResponse(device));
  }

  async findOneForOwner(id: string, ownerId: string): Promise<Device> {
    const device = await this.devicesRepository.findOne({ where: { id }, relations: { zone: true } });
    if (!device || device.zone.ownerId !== ownerId) {
      throw new NotFoundException('Device not found');
    }
    return device;
  }

  async getStatus(device: Device): Promise<DeviceStatusResponseDto> {
    const lastReading = await this.readingsRepository.findOne({
      where: { deviceId: device.id },
      order: { recordedAt: 'DESC' },
    });

    const windowMs =
      Number(process.env.DEVICE_ONLINE_WINDOW_SECONDS || DEFAULT_ONLINE_WINDOW_SECONDS) * 1000;
    const isOnline = !!lastReading && Date.now() - new Date(lastReading.recordedAt).getTime() <= windowMs;

    return {
      ...this.toResponse(device),
      isOnline,
      lastReading: lastReading ?? null,
    };
  }

  private toResponse(device: Device): DeviceResponseDto {
    return {
      id: device.id,
      name: device.name,
      zoneId: device.zoneId,
      createdAt: device.createdAt,
    };
  }

  private toCreatedResponse(device: Device): DeviceCreatedResponseDto {
    return {
      ...this.toResponse(device),
      apiKey: device.apiKey,
    };
  }
}
