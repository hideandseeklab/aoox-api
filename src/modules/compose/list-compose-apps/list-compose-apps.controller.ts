import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ProjectService } from '../../project/project.service';
import { hideEnv, type WithEnvHidden } from '../../project/env-visibility';
import { ComposeApp } from '../compose-app.entity';
import { ComposeService } from '../compose.service';

export class ListComposeAppsQueryDto {
  @IsUUID()
  projectId: string;
}

@Controller('compose-apps')
@UseGuards(JwtAuthGuard)
export class ListComposeAppsController {
  constructor(
    private readonly compose: ComposeService,
    private readonly projects: ProjectService,
  ) {}

  /** Without `logs` (can be large); GET /compose-apps/:id has them. */
  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListComposeAppsQueryDto,
  ): Promise<Omit<WithEnvHidden<ComposeApp>, 'logs'>[]> {
    const project = await this.projects.findOwnedOrFail(
      query.projectId,
      user.sub,
    );
    const canRead = await this.projects.access.canReadSecrets(
      user.sub,
      project,
    );
    const rows = await this.compose.repo.find({
      where: { projectId: query.projectId },
      order: { createdAt: 'DESC' },
    });
    return rows.map((row) => {
      const { logs, ...rest } = hideEnv(row, canRead);
      void logs;
      return rest;
    });
  }
}
