import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ApplicationService } from '../application.service';
import { PreviewService } from '../preview.service';

export class DeletePreviewParamsDto {
  @IsUUID()
  id: string;
}

/** Manual teardown (the webhook does this on PR close). */
@Controller('previews')
@UseGuards(JwtAuthGuard)
export class DeletePreviewController {
  constructor(
    private readonly applications: ApplicationService,
    private readonly previews: PreviewService,
  ) {}

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param() params: DeletePreviewParamsDto,
  ): Promise<void> {
    const preview = await this.previews.repo.findOne({
      where: { id: params.id },
    });
    if (!preview) throw new NotFoundException('Preview not found');
    const app = await this.applications.findOwnedOrFail(
      preview.applicationId,
      user.sub,
    );
    await this.previews.destroy(app, preview);
  }
}
