import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../users/user.entity';
import { moneyTransformer } from './money.transformer';

export type PaymentStatus = 'approved' | 'declined';

// Only the brand and the last 4 digits of the card are ever stored. The number,
// the holder and the cvc are never persisted.
@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  ownerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ownerId' })
  owner: User;

  @Column({ type: 'varchar', nullable: true })
  subscriptionId: string | null;

  @Column({ type: 'varchar' })
  planId: string;

  @Column({ type: 'int' })
  cameras: number;

  @Column({ type: 'varchar' })
  status: PaymentStatus;

  @Column({ type: 'varchar', nullable: true })
  reason: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, transformer: moneyTransformer })
  subtotal: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, transformer: moneyTransformer })
  igv: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, transformer: moneyTransformer })
  total: number;

  @Column({ type: 'varchar' })
  currency: string;

  @Column({ type: 'varchar' })
  cardBrand: string;

  @Column({ type: 'varchar', length: 4 })
  last4: string;

  @CreateDateColumn()
  createdAt: Date;
}
