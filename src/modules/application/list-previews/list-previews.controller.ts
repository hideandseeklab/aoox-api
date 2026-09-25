import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ApplicationService } from '../application.service';
import { PreviewDeployment } from '../preview-deployment.entity';
import { PreviewService } from '../preview.service';

export class ListPreviewsParamsDto {
  @IsUUID()
  id: string;
}

/** Open previews of an application (with logs; the web polls while building). */
@Controller('applications')
@UseGuards(JwtAuthGuard)
export class ListPreviewsController {
  constructor(
    private readonly applications: ApplicationService,
    private readonly previews: PreviewService,
  ) {}

  @Get(':id/previews')
  async list(
    @CurrentUser() user: JwtPayload,
    @Param() params: ListPreviewsParamsDto,
  ): Promise<PreviewDeployment[]> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    return this.previews.repo.find({
      where: { applicationId: app.id },
      order: { prNumber: 'DESC' },
    });
  }
}
