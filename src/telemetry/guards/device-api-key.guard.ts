import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { Device } from '../../devices/device.entity';

@Injectable()
export class DeviceApiKeyGuard implements CanActivate {
  constructor(
    @InjectRepository(Device)
    private readonly devicesRepository: Repository<Device>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.header('X-Device-Key');

    if (!apiKey) {
      throw new UnauthorizedException('Missing X-Device-Key header');
    }

    const device = await this.devicesRepository.findOne({ where: { apiKey } });
    if (!device) {
      throw new UnauthorizedException('Invalid device API key');
    }

    (request as Request & { device: Device }).device = device;
    return true;
  }
}
