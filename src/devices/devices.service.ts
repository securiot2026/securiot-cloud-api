import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Response } from 'express';
import { Device } from './device.entity';
import { Zone } from '../zones/zone.entity';
import { Reading } from '../telemetry/entities/reading.entity';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { DryRunRuleDto } from './dto/dry-run-rule.dto';
import { DeviceCreatedResponseDto, DeviceResponseDto, DeviceStatusResponseDto } from './dto/device-response.dto';
import { DeviceSetupPayloadResponseDto } from './dto/setup-payload-response.dto';
import { isWithinOnlineWindow, resolveLastSeen } from './device-presence';

const DEFAULT_ONLINE_WINDOW_SECONDS = 300;

const BLOCKED_EDGE_URL_HOSTS = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname.startsWith('127.') ||
  hostname.startsWith('169.254.') ||
  hostname === '0.0.0.0';

interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

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

  async getSetupPayload(id: string, ownerId: string): Promise<DeviceSetupPayloadResponseDto> {
    // Ownership first: foreign and unknown ids raise the same 404 before anything else is read.
    const device = await this.findOneForOwner(id, ownerId);

    if (!device.edgeUrl) {
      throw new BadRequestException('edgeUrl not configured for this device');
    }

    // Read at request time (same pattern as EDGE_ADMIN_API_KEY). The value must never reach a
    // logger or an exception message; the 503 text names the variable, not its content.
    const deviceKey = process.env.EDGE_DEVICE_SHARED_SECRET;
    if (deviceKey === undefined || deviceKey.trim() === '') {
      throw new ServiceUnavailableException('Device setup secret is not configured on the server');
    }

    return {
      // The firmware appends "/frames" to this base URL, so it must not end with a slash.
      edgeApiUrl: device.edgeUrl.replace(/\/+$/, ''),
      deviceKey,
      deviceId: device.id,
      zoneId: device.zoneId,
    };
  }

  async update(id: string, dto: UpdateDeviceDto, ownerId: string): Promise<DeviceResponseDto> {
    const device = await this.findOneForOwner(id, ownerId);

    if (dto.edgeUrl !== undefined) {
      const hostname = new URL(dto.edgeUrl).hostname;
      if (BLOCKED_EDGE_URL_HOSTS(hostname)) {
        throw new BadRequestException('edgeUrl cannot point to a loopback or link-local host');
      }
      device.edgeUrl = dto.edgeUrl;
    }

    const saved = await this.devicesRepository.save(device);
    return this.toResponse(saved);
  }

  async enrollFace(
    id: string,
    ownerId: string,
    name: string,
    images: UploadedFile[],
    res: Response,
  ): Promise<void> {
    const device = await this.findOneForOwner(id, ownerId);

    if (!device.edgeUrl) {
      res.status(400).json({ error: 'edgeUrl not configured for this device' });
      return;
    }

    const formData = new FormData();
    formData.append('name', name);
    for (const image of images) {
      formData.append(
        'images',
        new Blob([new Uint8Array(image.buffer)], { type: image.mimetype }),
        image.originalname,
      );
    }

    await this.callDeviceEdgeApi(device, '/faces', { method: 'POST', body: formData }, res);
  }

  async getFaceRecognitionStatus(id: string, ownerId: string, res: Response): Promise<void> {
    const device = await this.findOneForOwner(id, ownerId);

    if (!device.edgeUrl) {
      res.status(400).json({ error: 'edgeUrl not configured for this device' });
      return;
    }

    await this.callDeviceEdgeApi(device, `/devices/${id}/face-recognition`, { method: 'GET' }, res);
  }

  async setFaceRecognitionStatus(id: string, ownerId: string, enabled: boolean, res: Response): Promise<void> {
    const device = await this.findOneForOwner(id, ownerId);

    if (!device.edgeUrl) {
      res.status(400).json({ error: 'edgeUrl not configured for this device' });
      return;
    }

    await this.callDeviceEdgeApi(
      device,
      `/devices/${id}/face-recognition`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      },
      res,
    );
  }

  async createCommand(
    id: string,
    ownerId: string,
    dto: { actuator: string; action: Record<string, unknown> },
    res: Response,
  ): Promise<void> {
    const device = await this.findOneForOwner(id, ownerId);

    if (!device.edgeUrl) {
      res.status(400).json({ error: 'edgeUrl not configured for this device' });
      return;
    }

    await this.callDeviceEdgeApi(
      device,
      '/commands',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: id, actuator: dto.actuator, action: dto.action }),
      },
      res,
    );
  }

  async getCommandStatus(id: string, ownerId: string, actuator: string, res: Response): Promise<void> {
    const device = await this.findOneForOwner(id, ownerId);

    if (!['pan_tilt', 'light', 'buzzer'].includes(actuator)) {
      res.status(400).json({ error: 'actuator must be one of pan_tilt, light, buzzer' });
      return;
    }

    if (!device.edgeUrl) {
      res.status(400).json({ error: 'edgeUrl not configured for this device' });
      return;
    }

    await this.callDeviceEdgeApi(
      device,
      `/commands/${id}/status?actuator=${encodeURIComponent(actuator)}`,
      { method: 'GET' },
      res,
    );
  }

  async getOccupancy(id: string, ownerId: string, res: Response): Promise<void> {
    const device = await this.findOneForOwner(id, ownerId);

    if (!device.edgeUrl) {
      res.status(400).json({ error: 'edgeUrl not configured for this device' });
      return;
    }

    await this.callDeviceEdgeApi(device, `/occupancy/${id}`, { method: 'GET' }, res);
  }

  async getLatestFrame(id: string, ownerId: string, res: Response): Promise<void> {
    const device = await this.findOneForOwner(id, ownerId);

    if (!device.edgeUrl) {
      res.status(400).json({ error: 'edgeUrl not configured for this device' });
      return;
    }

    // FEED-03: no Cloud-side storage of any kind — this always proxies live
    // to the Edge API's own single-frame cache (app/frame_cache.py) and
    // never persists or retains the response here, so Cloud cannot
    // accumulate frame history even by omission.
    await this.callDeviceEdgeApi(device, `/frames/latest/${id}`, { method: 'GET' }, res);
  }

  async listRules(id: string, ownerId: string, res: Response): Promise<void> {
    const device = await this.findOneForOwner(id, ownerId);

    if (!device.edgeUrl) {
      res.status(400).json({ error: 'edgeUrl not configured for this device' });
      return;
    }

    await this.callDeviceEdgeApi(device, `/rules?device_id=${encodeURIComponent(id)}`, { method: 'GET' }, res);
  }

  async createRule(id: string, ownerId: string, dto: Record<string, unknown>, res: Response): Promise<void> {
    const device = await this.findOneForOwner(id, ownerId);

    if (!device.edgeUrl) {
      res.status(400).json({ error: 'edgeUrl not configured for this device' });
      return;
    }

    await this.callDeviceEdgeApi(
      device,
      '/rules',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...dto, device_id: id }),
      },
      res,
    );
  }

  async updateRule(
    id: string,
    ruleId: string,
    ownerId: string,
    dto: Record<string, unknown>,
    res: Response,
  ): Promise<void> {
    const device = await this.findOneForOwner(id, ownerId);

    if (!device.edgeUrl) {
      res.status(400).json({ error: 'edgeUrl not configured for this device' });
      return;
    }

    await this.callDeviceEdgeApi(
      device,
      `/rules/${encodeURIComponent(ruleId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dto),
      },
      res,
    );
  }

  async deleteRule(id: string, ruleId: string, ownerId: string, res: Response): Promise<void> {
    const device = await this.findOneForOwner(id, ownerId);

    if (!device.edgeUrl) {
      res.status(400).json({ error: 'edgeUrl not configured for this device' });
      return;
    }

    await this.callDeviceEdgeApi(device, `/rules/${encodeURIComponent(ruleId)}`, { method: 'DELETE' }, res);
  }

  async dryRunRule(id: string, ruleId: string, ownerId: string, dto: DryRunRuleDto, res: Response): Promise<void> {
    const device = await this.findOneForOwner(id, ownerId);

    if (!device.edgeUrl) {
      res.status(400).json({ error: 'edgeUrl not configured for this device' });
      return;
    }

    // Identity always comes from our own Device row, never from client input (T-12-02-02).
    await this.callDeviceEdgeApi(
      device,
      `/rules/${encodeURIComponent(ruleId)}/dry-run`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: device.id,
          zone_id: device.zoneId,
          execute: dto?.execute === true,
        }),
      },
      res,
    );
  }

  private async callDeviceEdgeApi(device: Device, path: string, init: RequestInit, res: Response): Promise<void> {
    let edgeResponse: globalThis.Response;
    try {
      edgeResponse = await fetch(`${device.edgeUrl}${path}`, {
        ...init,
        headers: { ...(init.headers || {}), 'X-Admin-Key': process.env.EDGE_ADMIN_API_KEY || '' },
      });
    } catch {
      throw new BadGatewayException('Could not reach the device Edge API');
    }

    const edgeBody = await edgeResponse.json().catch(() => ({}));

    if (edgeResponse.status === 401) {
      res.status(502).json({ error: 'Edge API rejected the admin credential — check EDGE_ADMIN_API_KEY' });
      return;
    }

    res.status(edgeResponse.status).json(edgeBody);
  }

  async getStatus(device: Device): Promise<DeviceStatusResponseDto> {
    const lastReading = await this.readingsRepository.findOne({
      where: { deviceId: device.id },
      order: { recordedAt: 'DESC' },
    });

    const windowMs =
      Number(process.env.DEVICE_ONLINE_WINDOW_SECONDS || DEFAULT_ONLINE_WINDOW_SECONDS) * 1000;
    const lastSeen = resolveLastSeen(device.lastSeenAt, lastReading?.recordedAt);
    const isOnline = isWithinOnlineWindow(lastSeen, windowMs, Date.now());

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
      edgeUrl: device.edgeUrl,
    };
  }

  private toCreatedResponse(device: Device): DeviceCreatedResponseDto {
    return {
      ...this.toResponse(device),
      apiKey: device.apiKey,
    };
  }
}
