import { Injectable } from '@nestjs/common';
import { DockerService } from '../../docker/docker.service';
import { ProjectAccessService } from '../../project/project-access.service';
import type { ProjectRole } from '../../project/project-member.entity';
import { ManagedDatabase } from '../managed-database.entity';
import {
  containerNameForDb,
  ManagedDatabaseService,
} from '../managed-database.service';
import { retryModeFor, type RetryMode } from '../retry-plan';

export interface ManagedDatabaseDetail extends ManagedDatabase {
  container: { id: string; state: string; status: string } | null;
  /** The actor's role in the owning project (UI hides what a viewer cannot do). */
  projectRole: ProjectRole;
  /**
   * `POST /databases/:id/reprovision` would be accepted: status `error`, and
   * not the row an API restart interrupted (that one must be recreated).
   */
  retryable: boolean;
  /**
   * What a retry does to the data volume: `fresh-volume` (never ready, nothing
   * to lose: the volume is recreated) or `reuse-volume` (kept). Null = not retryable.
   */
  retryMode: RetryMode | null;
}

@Injectable()
export class GetDatabaseService {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly docker: DockerService,
    private readonly access: ProjectAccessService,
  ) {}

  async execute(ownerId: string, id: string): Promise<ManagedDatabaseDetail> {
    const db = await this.databases.findOwnedOrFail(id, ownerId);
    const projectRole = (await this.access.roleFor(ownerId, db.project))!;
    const c = await this.docker
      .findContainerByName(containerNameForDb(db))
      .catch(() => null);
    const retryMode = retryModeFor(db);
    return {
      ...db,
      container: c ? { id: c.Id, state: c.State, status: c.Status } : null,
      projectRole,
      retryable: retryMode !== null,
      retryMode,
    };
  }
}
