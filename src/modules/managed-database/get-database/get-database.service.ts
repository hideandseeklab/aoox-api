import { Injectable } from '@nestjs/common';
import { DockerService } from '../../docker/docker.service';
import { ProjectAccessService } from '../../project/project-access.service';
import type { ProjectRole } from '../../project/project-member.entity';
import { ManagedDatabase } from '../managed-database.entity';
import {
  containerNameForDb,
  ManagedDatabaseService,
} from '../managed-database.service';

export interface ManagedDatabaseDetail extends ManagedDatabase {
  container: { id: string; state: string; status: string } | null;
  /** The actor's role in the owning project (UI hides what a viewer cannot do). */
  projectRole: ProjectRole;
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
    return {
      ...db,
      container: c ? { id: c.Id, state: c.State, status: c.Status } : null,
      projectRole,
    };
  }
}
