import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ProjectAccessService } from '../../project/project-access.service';
import { ApplicationService } from '../application.service';
import { ApplicationParamsDto } from '../get-application/get-application.dto';
import { MountView, mountView } from '../mounts';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class ListMountsController {
  constructor(
    private readonly applications: ApplicationService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get(':id/mounts')
  async list(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
  ): Promise<MountView[]> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    const canRead = await this.access.canReadSecrets(user.sub, app.project);
    const mounts = await this.applications.mounts.find({
      where: { applicationId: app.id },
      order: { createdAt: 'ASC' },
    });
    return mounts.map((m) => mountView(m, canRead));
  }
}
