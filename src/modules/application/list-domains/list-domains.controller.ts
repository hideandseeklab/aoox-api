import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ApplicationService } from '../application.service';
import { Domain } from '../domain.entity';
import { ApplicationParamsDto } from '../get-application/get-application.dto';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class ListDomainsController {
  constructor(private readonly applications: ApplicationService) {}

  @Get(':id/domains')
  async list(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
  ): Promise<Domain[]> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    return this.applications.domains.find({
      where: { applicationId: app.id },
      order: { createdAt: 'ASC' },
    });
  }
}
