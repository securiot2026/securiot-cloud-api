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

  @Column({ type: 'varchar', nullable: true })
  edgeUrl: string | null;

  /** Last heartbeat received from the Edge (D-06). Null until the device reports. */
  @Column({ type: Date, nullable: true })
  lastSeenAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
