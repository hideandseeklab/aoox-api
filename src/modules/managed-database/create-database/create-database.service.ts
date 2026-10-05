import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DockerService } from '../../docker/docker.service';
import { HostPortService } from '../../host-port/host-port.service';
import { ProjectService } from '../../project/project.service';
import { defaultTagFor, ENGINES } from '../engines';
import { ManagedDatabase } from '../managed-database.entity';
import { ManagedDatabaseService } from '../managed-database.service';
import { CreateDatabaseDto } from './create-database.dto';

@Injectable()
export class CreateDatabaseService {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly projects: ProjectService,
    private readonly hostPorts: HostPortService,
    private readonly docker: DockerService,
  ) {}

  async execute(
    ownerId: string,
    dto: CreateDatabaseDto,
  ): Promise<ManagedDatabase> {
    const project = await this.projects.findOwnedOrFail(dto.projectId, ownerId);
    // Databases always run on the aoox host. A port another app, database,
    // stack, companion or any running container already publishes would only
    // fail later in the background provision (status `error`): reject it now.
    if (dto.hostPort != null) {
      await this.hostPorts.assertFree([dto.hostPort], this.docker);
    }
    const spec = ENGINES[dto.engine];
    const slug = ManagedDatabaseService.slugify(dto.name);
    // Alphanumeric password: safe in env vars, CLI args and URLs alike.
    const password = randomBytes(18)
      .toString('base64url')
      .replace(/[-_]/g, 'x');

    const db = await this.databases.repo.save(
      this.databases.repo.create({
        projectId: project.id,
        name: dto.name.trim(),
        slug,
        engine: dto.engine,
        variant: dto.engine === 'postgres' ? (dto.variant ?? null) : null,
        imageTag:
          dto.imageTag?.trim() ||
          defaultTagFor(
            dto.engine,
            dto.engine === 'postgres' ? (dto.variant ?? null) : null,
          ),
        databaseName: spec.hasDatabase ? slug.replace(/-/g, '_') : '',
        username: spec.hasDatabase ? 'app' : 'default',
        passwordEncrypted: this.databases.encrypt(password),
        hostPort: dto.hostPort ?? null,
        cpuMillicores: dto.cpuMillicores ?? null,
        memoryMb: dto.memoryMb ?? null,
        status: 'creating',
      }),
    );
    this.databases.provisionInBackground(db, password);
    return db;
  }
}
