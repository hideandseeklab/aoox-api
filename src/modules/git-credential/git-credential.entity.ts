import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type GitProvider = 'github' | 'gitlab' | 'generic';

/**
 * HTTPS credentials for private git repositories. The token is injected into
 * the clone URL the Docker daemon uses (`https://user:token@host/repo`).
 */
@Entity({ name: 'git_credentials' })
export class GitCredential {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'varchar' })
  provider: GitProvider;

  /** GitHub: any non-empty value (e.g. `x-access-token`); GitLab: deploy token username. */
  @Column()
  username: string;

  @Column({ name: 'token_encrypted', type: 'text', select: false })
  tokenEncrypted: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
