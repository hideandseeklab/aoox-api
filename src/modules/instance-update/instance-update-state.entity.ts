import { Column, Entity, PrimaryColumn } from 'typeorm';

export const INSTANCE_UPDATE_STATE_ID = 'default';

/**
 * Single-row table: last known registry digest of the panel's own `api`/`web`
 * images, captured via the same registry-digest-only comparison
 * `ImageDigestService` uses for application auto-update (never compare a
 * remote digest against a local `docker inspect` value — see AGENTS.md
 * "Update otomatis image" — different representations of "the same" digest
 * can disagree and cause a false "update available" forever).
 */
@Entity({ name: 'instance_update_state' })
export class InstanceUpdateState {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Column({ name: 'api_digest', type: 'varchar', nullable: true })
  apiDigest: string | null;

  @Column({ name: 'web_digest', type: 'varchar', nullable: true })
  webDigest: string | null;

  @Column({ name: 'checked_at', type: 'timestamptz', nullable: true })
  checkedAt: Date | null;
}
