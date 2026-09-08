import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Zone } from '../zones/zone.entity';
import { Device } from '../devices/device.entity';
import { Reading } from '../telemetry/entities/reading.entity';

@Entity('alerts')
@Unique(['readingId'])
export class Alert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Zone, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'zoneId' })
  zone: Zone;

  @Column()
  zoneId: string;

  @ManyToOne(() => Device, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deviceId' })
  device: Device;

  @Column()
  deviceId: string;

  @ManyToOne(() => Reading, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'readingId' })
  reading: Reading | null;

  @Column({ nullable: true })
  readingId: string | null;

  @Column()
  ruleType: string;

  @Column()
  severity: string;

  @Column({ default: 'active' })
  status: string;

  @Column()
  message: string;

  @CreateDateColumn()
  createdAt: Date;
}
