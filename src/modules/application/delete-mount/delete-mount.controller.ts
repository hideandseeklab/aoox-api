import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsBooleanString, IsOptional } from 'class-validator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { RemoteDockerService } from '../../server/remote-docker.service';
import { ApplicationService } from '../application.service';
import { DeploymentRunnerService } from '../deployment-runner.service';
import { volumeNameFor } from '../mounts';
import { MountParamsDto } from '../update-mount/update-mount.dto';

class DeleteMountQueryDto {
  /** `true` also deletes the Docker volume (volume mounts) — data is gone. */
  @IsOptional()
  @IsBooleanString()
  purge?: string;
}

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class DeleteMountController {
  constructor(
    private readonly applications: ApplicationService,
    private readonly runner: DeploymentRunnerService,
    private readonly remote: RemoteDockerService,
  ) {}

  @Delete(':id/mounts/:mountId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param() params: MountParamsDto,
    @Query() query: DeleteMountQueryDto,
  ): Promise<void> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    const mount = await this.applications.mounts.findOne({
      where: { id: params.mountId, applicationId: app.id },
    });
    if (!mount) throw new NotFoundException('Mount not found');
    await this.applications.mounts.remove(mount);
    // The container must let go of the volume before it can be removed.
    await this.runner.applyRuntimeConfig(app);
    if (mount.type === 'volume' && query.purge === 'true') {
      const docker = await this.remote.forServer(app.serverId);
      await docker.engine
        .removeVolume(volumeNameFor(app, mount))
        .catch(() => undefined);
    }
  }
}
