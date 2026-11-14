import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { User } from '../users/user.entity';

/**
 * One password reset request. Only the SHA-256 hex digest of the token is stored, never the raw
 * token that travels in the email link.
 */
@Entity('password_reset_tokens')
@Unique(['tokenHash'])
export class PasswordResetToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  userId: string;

  @Column()
  tokenHash: string;

  @Column()
  expiresAt: Date;

  @Column({ type: Date, nullable: true })
  usedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
