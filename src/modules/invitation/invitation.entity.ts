import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../user/user.entity';
import type { UserRole } from '../user/user.entity';

/**
 * An invitation to join this instance with a given role. The link carries a
 * random token; only its SHA-256 is stored, like a password. One pending
 * invitation per email; accepted ones are kept as history.
 */
@Entity({ name: 'invitations' })
export class Invitation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  email: string;

  @Column({ type: 'varchar' })
  role: UserRole;

  @Index({ unique: true })
  @Column({ name: 'token_hash', select: false })
  tokenHash: string;

  @Column({ name: 'invited_by_id', type: 'uuid', nullable: true })
  invitedById: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'invited_by_id' })
  invitedBy: User | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
