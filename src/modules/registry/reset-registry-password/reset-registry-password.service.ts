import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DockerService } from '../../docker/docker.service';
import { RegistryService } from '../registry.service';
import { SelfHostedRegistryService } from '../self-hosted-registry.service';
import { ResetRegistryPasswordResponseDto } from './reset-registry-password.dto';

/**
 * Gives the self-hosted registry a new password without touching its images:
 * only the htpasswd file in the auth volume, the container (restart) and the
 * encrypted password in the DB change. The data volume / S3 storage is not
 * mounted or read. Any failure leaves the old password in force.
 */
@Injectable()
export class ResetRegistryPasswordService {
  private readonly logger = new Logger(ResetRegistryPasswordService.name);

  constructor(
    private readonly docker: DockerService,
    private readonly selfHosted: SelfHostedRegistryService,
    private readonly registries: RegistryService,
  ) {}

  async execute(): Promise<ResetRegistryPasswordResponseDto> {
    if (!(await this.docker.ping())) {
      throw new ServiceUnavailableException('Docker engine is not reachable');
    }
    const registry = await this.registries.findSelfHosted();
    if (!registry) {
      throw new NotFoundException('Self-hosted registry is not provisioned');
    }
    const container = await this.selfHosted.status();
    if (!container.installed) {
      throw new NotFoundException(
        'The registry container does not exist; enable the registry again',
      );
    }

    const password = randomBytes(24).toString('base64url');
    const htpasswd = await this.selfHosted.htpasswdFor(password);

    try {
      await this.selfHosted.writeHtpasswd(htpasswd, true);
    } catch (err) {
      // The write is atomic (temp file + mv): the old file is still in place.
      throw new BadGatewayException(
        `Could not write the new password: ${errorText(err)}. The old password still works.`,
      );
    }

    try {
      await this.selfHosted.restartRegistry();
      registry.passwordEncrypted = this.registries.encryptPassword(password);
      await this.registries.repo.save(registry);
    } catch (err) {
      await this.rollback();
      throw new BadGatewayException(
        `Could not apply the new password: ${errorText(err)}. The old password still works.`,
      );
    }

    this.logger.log('Self-hosted registry password was reset');
    return { username: registry.username ?? 'aoox', password };
  }

  /** Puts the previous htpasswd back and restarts so the registry uses it again. */
  private async rollback(): Promise<void> {
    try {
      await this.selfHosted.restoreHtpasswd();
      await this.selfHosted.restartRegistry();
    } catch (err) {
      this.logger.error(
        `Rolling back the registry password failed: ${errorText(err)}`,
      );
    }
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
