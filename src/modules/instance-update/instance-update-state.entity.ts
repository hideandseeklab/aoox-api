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

  /**
   * Set by `apply()`, cleared by `check()`/`pingApplyStatus()` once the
   * running process's own version differs from `applyFromVersion` — i.e. this
   * very container has been recreated with the new image. Survives a page
   * reload mid-update (the card reads it from `GET /instance/update` on
   * first render), and survives the API's own restart (it's DB state, not
   * in-memory).
   */
  @Column({ name: 'apply_started_at', type: 'timestamptz', nullable: true })
  applyStartedAt: Date | null;

  /** `currentVersion` at the moment `apply()` was called. */
  @Column({ name: 'apply_from_version', type: 'varchar', nullable: true })
  applyFromVersion: string | null;
}
