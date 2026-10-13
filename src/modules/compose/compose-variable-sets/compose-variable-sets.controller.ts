import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { OwnerVariableSetsService } from '../../application/variable-set-links/variable-set-links.service';
import { ReplaceLinksDto } from '../../variable-set/variable-set.dto';
import type { LinkView } from '../../variable-set/variable-set-link.service';
import { ComposeAppParamsDto } from '../compose-app.dto';
import { ComposeService } from '../compose.service';
import { asTarget } from '../create-compose-app/create-compose-app.service';

@Controller('compose-apps/:id/variable-sets')
@UseGuards(JwtAuthGuard)
export class ComposeVariableSetsController {
  constructor(
    private readonly compose: ComposeService,
    private readonly links: OwnerVariableSetsService,
  ) {}

  /** The ordered links with set/environment names, keys and per-key conflicts (no values). */
  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Param() params: ComposeAppParamsDto,
  ): Promise<{ links: LinkView[] }> {
    const app = await this.compose.findOwnedOrFail(params.id, user.sub);
    return {
      links: await this.links.views(
        { kind: 'compose', id: app.id, projectId: app.projectId },
        app.env,
      ),
    };
  }

  /** Replaces the ordered list; takes effect on the next deploy. */
  @Put()
  async replace(
    @CurrentUser() user: JwtPayload,
    @Param() params: ComposeAppParamsDto,
    @Body() dto: ReplaceLinksDto,
  ): Promise<{ links: LinkView[] }> {
    const app = await this.compose.findOwnedOrFail(params.id, user.sub);
    return {
      links: await this.links.replace(
        { kind: 'compose', id: app.id, projectId: app.projectId },
        asTarget(app),
        dto.links.map((l) => l.environmentId),
        user.sub,
      ),
    };
  }
}
