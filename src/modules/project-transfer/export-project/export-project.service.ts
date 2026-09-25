import { ForbiddenException, Injectable } from '@nestjs/common';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ProjectService } from '../../project/project.service';
import { ProjectExportService } from '../project-export.service';
import { ProjectExport } from '../project-export.types';

@Injectable()
export class ExportProjectService {
  constructor(
    private readonly projects: ProjectService,
    private readonly exporter: ProjectExportService,
  ) {}

  async execute(
    user: JwtPayload,
    projectId: string,
    includeSecrets: boolean,
  ): Promise<ProjectExport> {
    const project = await this.projects.findOwnedOrFail(projectId, user.sub);
    // Database passwords otherwise need the owner-only credentials endpoint too.
    if (includeSecrets && user.role !== 'owner') {
      throw new ForbiddenException('Only owners can export secrets');
    }
    return this.exporter.export(project, includeSecrets);
  }
}
