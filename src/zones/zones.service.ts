import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Zone } from './zone.entity';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';

@Injectable()
export class ZonesService {
  constructor(
    @InjectRepository(Zone)
    private readonly zonesRepository: Repository<Zone>,
  ) {}

  create(dto: CreateZoneDto, ownerId: string): Promise<Zone> {
    return this.zonesRepository.save(this.zonesRepository.create({ ...dto, ownerId }));
  }

  findAllForOwner(ownerId: string): Promise<Zone[]> {
    return this.zonesRepository.find({ where: { ownerId } });
  }

  async findOneForOwner(id: string, ownerId: string): Promise<Zone> {
    const zone = await this.zonesRepository.findOne({ where: { id, ownerId } });
    if (!zone) {
      throw new NotFoundException('Zone not found');
    }
    return zone;
  }

  async update(id: string, ownerId: string, dto: UpdateZoneDto): Promise<Zone> {
    const zone = await this.findOneForOwner(id, ownerId);
    Object.assign(zone, dto);
    return this.zonesRepository.save(zone);
  }

  async remove(id: string, ownerId: string): Promise<void> {
    const zone = await this.findOneForOwner(id, ownerId);
    await this.zonesRepository.remove(zone);
  }
}
