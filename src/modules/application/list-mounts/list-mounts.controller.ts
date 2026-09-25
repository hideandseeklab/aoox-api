import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ApplicationService } from '../application.service';
import { ApplicationParamsDto } from '../get-application/get-application.dto';
import { Mount } from '../mount.entity';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class ListMountsController {
  constructor(private readonly applications: ApplicationService) {}

  @Get(':id/mounts')
  async list(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
  ): Promise<Mount[]> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    return this.applications.mounts.find({
      where: { applicationId: app.id },
      order: { createdAt: 'ASC' },
    });
  }
}
