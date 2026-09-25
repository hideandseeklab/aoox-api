import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { ProjectService } from '../../project/project.service';
import { ENGINES } from '../engines';
import { ManagedDatabase } from '../managed-database.entity';
import { ManagedDatabaseService } from '../managed-database.service';
import { CreateDatabaseDto } from './create-database.dto';

@Injectable()
export class CreateDatabaseService {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly projects: ProjectService,
  ) {}

  async execute(
    ownerId: string,
    dto: CreateDatabaseDto,
  ): Promise<ManagedDatabase> {
    const project = await this.projects.findOwnedOrFail(dto.projectId, ownerId);
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
        imageTag: dto.imageTag?.trim() || spec.defaultTag,
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
