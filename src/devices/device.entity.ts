import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Zone } from '../zones/zone.entity';

@Entity('devices')
@Unique(['apiKey'])
export class Device {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  apiKey: string;

  @ManyToOne(() => Zone, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'zoneId' })
  zone: Zone;

  @Column()
  zoneId: string;
}
