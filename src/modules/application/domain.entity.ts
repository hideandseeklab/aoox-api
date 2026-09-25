import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Application } from './application.entity';

/** A hostname routed by the proxy to an application container. */
@Entity({ name: 'domains' })
export class Domain {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'application_id', type: 'uuid' })
  applicationId: string;

  @ManyToOne(() => Application, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'application_id' })
  application: Application;

  /** FQDN, lowercase, e.g. `app.example.com`. Unique across the install. */
  @Index({ unique: true })
  @Column()
  host: string;

  /** Also serve on the websecure entrypoint with an ACME certificate. */
  @Column({ default: false })
  https: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
