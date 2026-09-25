import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ApplicationService } from '../application.service';
import { DeploymentRunnerService } from '../deployment-runner.service';
import { DeleteDomainParamsDto } from './delete-domain.dto';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class DeleteDomainController {
  constructor(
    private readonly applications: ApplicationService,
    private readonly runner: DeploymentRunnerService,
  ) {}

  @Delete(':id/domains/:domainId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param() params: DeleteDomainParamsDto,
  ): Promise<void> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    const domain = await this.applications.domains.findOne({
      where: { id: params.domainId, applicationId: app.id },
    });
    if (!domain) throw new NotFoundException('Domain not found');
    await this.applications.domains.remove(domain);
    await this.runner.applyRuntimeConfig(app);
  }
}
