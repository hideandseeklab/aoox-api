import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type RegistryType = 'self-hosted' | 'external';

/** A Docker registry images can be pushed to / pulled from. Platform-wide. */
@Entity({ name: 'registries' })
export class Registry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'varchar' })
  type: RegistryType;

  /** Host[:port] as used by `docker push`, e.g. `localhost:5000`, `ghcr.io`. */
  @Column()
  url: string;

  @Column({ type: 'varchar', nullable: true })
  username: string | null;

  /** AES-256-GCM, see registry-secret.util.ts. Never selected by default. */
  @Column({
    name: 'password_encrypted',
    type: 'text',
    nullable: true,
    select: false,
  })
  passwordEncrypted: string | null;

  /** Optional namespace prefix for pushed images, e.g. `myorg`. */
  @Column({ name: 'image_prefix', type: 'varchar', nullable: true })
  imagePrefix: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
