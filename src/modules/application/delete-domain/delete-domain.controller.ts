import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CertificateSyncService } from '../../certificate/certificate-sync.service';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ApplicationService } from '../application.service';
import { DeploymentRunnerService } from '../deployment-runner.service';
import { DeleteDomainParamsDto } from './delete-domain.dto';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class DeleteDomainController {
  private readonly logger = new Logger(DeleteDomainController.name);

  constructor(
    private readonly applications: ApplicationService,
    private readonly runner: DeploymentRunnerService,
    private readonly certSync: CertificateSyncService,
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
    const hadCertificate = !!domain.certificateId;
    await this.applications.domains.remove(domain);
    await this.runner.applyRuntimeConfig(app);
    if (hadCertificate) {
      // Drop the certificate files no domain uses any more (a key must not
      // outlive its assignment). The domain is already gone: best effort.
      await this.certSync
        .syncServer(app.serverId)
        .catch((err) =>
          this.logger.warn(`Certificate cleanup failed: ${String(err)}`),
        );
    }
  }
}
