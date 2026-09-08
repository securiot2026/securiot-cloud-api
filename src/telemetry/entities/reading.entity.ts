import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Device } from '../../devices/device.entity';
import { Zone } from '../../zones/zone.entity';

@Entity('readings')
@Unique(['readingId'])
export class Reading {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  readingId: string;

  @ManyToOne(() => Device, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deviceId' })
  device: Device;

  @Column()
  deviceId: string;

  @ManyToOne(() => Zone, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'zoneId' })
  zone: Zone;

  @Column()
  zoneId: string;

  @Column()
  sensorType: string;

  @Column('simple-json')
  value: unknown;

  @Column()
  recordedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
