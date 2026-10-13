import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ReplaceLinksDto } from '../../variable-set/variable-set.dto';
import type { LinkView } from '../../variable-set/variable-set-link.service';
import { ApplicationService } from '../application.service';
import { ApplicationParamsDto } from '../get-application/get-application.dto';
import { OwnerVariableSetsService } from './variable-set-links.service';

@Controller('applications/:id/variable-sets')
@UseGuards(JwtAuthGuard)
export class ApplicationVariableSetsController {
  constructor(
    private readonly applications: ApplicationService,
    private readonly links: OwnerVariableSetsService,
  ) {}

  /** The ordered links with set/environment names, keys and per-key conflicts (no values). */
  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
  ): Promise<{ links: LinkView[] }> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    return {
      links: await this.links.views(
        { kind: 'application', id: app.id, projectId: app.projectId },
        app.env,
      ),
    };
  }

  /** Replaces the ordered list (developer and up; protected environments need the project admin). */
  @Put()
  async replace(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
    @Body() dto: ReplaceLinksDto,
  ): Promise<{ links: LinkView[] }> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    return {
      links: await this.links.replace(
        { kind: 'application', id: app.id, projectId: app.projectId },
        app,
        dto.links.map((l) => l.environmentId),
        user.sub,
      ),
    };
  }
}
