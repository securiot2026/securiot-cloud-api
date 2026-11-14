import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../users/user.entity';
import { moneyTransformer } from './money.transformer';

export type SubscriptionStatus = 'active' | 'canceled';

@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  ownerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ownerId' })
  owner: User;

  @Column({ type: 'varchar' })
  planId: string;

  @Column({ type: 'int' })
  cameras: number;

  @Column({ type: 'varchar' })
  status: SubscriptionStatus;

  @Column({ type: 'decimal', precision: 12, scale: 2, transformer: moneyTransformer })
  monthlyPerCamera: number;

  @Column({ type: Date })
  currentPeriodEnd: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
