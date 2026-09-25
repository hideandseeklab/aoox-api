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

/**
 * A personal access token for CI/CLI use. Acts as its user (same role by
 * default, optionally narrowed by `readOnly`/`projectIds`); only the
 * SHA-256 of the secret is stored, the plaintext is shown once.
 */
@Entity({ name: 'api_tokens' })
export class ApiToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column()
  name: string;

  @Index({ unique: true })
  @Column({ name: 'token_hash', select: false })
  tokenHash: string;

  /** First characters of the token, for recognition in lists (`aoox_ab12…`). */
  @Column()
  prefix: string;

  /** Read-only token: every state-changing request is refused (403). */
  @Column({ name: 'read_only', default: false })
  readOnly: boolean;

  /**
   * Projects this token may touch; `null` = whatever its user may see.
   * A scope never widens access — it is intersected with the user's own
   * (see ProjectAccessService) — and such a token is refused on
   * platform-wide routes entirely.
   */
  @Column({ name: 'project_ids', type: 'jsonb', nullable: true })
  projectIds: string[] | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
