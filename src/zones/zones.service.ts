import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Zone } from './zone.entity';
import { CreateZoneDto } from './dto/create-zone.dto';

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
}
