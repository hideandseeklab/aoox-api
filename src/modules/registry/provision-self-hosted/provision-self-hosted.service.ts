import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BackupDestinationService } from '../../backup-destination/backup-destination.service';
import { DockerService } from '../../docker/docker.service';
import { RegistryService } from '../registry.service';
import { SelfHostedRegistryService } from '../self-hosted-registry.service';
import {
  ProvisionSelfHostedDto,
  ProvisionSelfHostedResponseDto,
} from './provision-self-hosted.dto';

@Injectable()
export class ProvisionSelfHostedService {
  constructor(
    private readonly docker: DockerService,
    private readonly selfHosted: SelfHostedRegistryService,
    private readonly registries: RegistryService,
    private readonly destinations: BackupDestinationService,
  ) {}

  async execute(
    dto: ProvisionSelfHostedDto,
  ): Promise<ProvisionSelfHostedResponseDto> {
    if (!(await this.docker.ping())) {
      throw new ServiceUnavailableException('Docker engine is not reachable');
    }
    if (await this.registries.findSelfHosted()) {
      throw new ConflictException('Self-hosted registry already provisioned');
    }
    if (dto.purgeVolumes && !dto.replace) {
      throw new BadRequestException('purgeVolumes requires replace');
    }
    const existing = await this.selfHosted.status();
    if (existing.installed && !dto.replace) {
      throw new ConflictException({
        statusCode: 409,
        code: 'registry-container-exists',
        message:
          'A container named aoox-registry already exists on this server but is not registered in aoox. ' +
          'Provisioning would collide with it. Choose to replace it (its data volumes are kept unless you also purge them), or remove it manually.',
        error: 'Conflict',
      });
    }

    // Resolve first: a bad destination must not cost the operator the old container.
    const destination = dto.destinationId
      ? (await this.destinations.resolve(dto.destinationId)).config
      : null;

    if (existing.installed) {
      await this.selfHosted.remove(dto.purgeVolumes === true);
    }

    const { username, password } = await this.selfHosted.provision(destination);
    const entity = this.registries.repo.create({
      name: 'Local registry',
      type: 'self-hosted',
      url: this.selfHosted.publicUrl,
      username,
      passwordEncrypted: this.registries.encryptPassword(password),
      imagePrefix: null,
      domain: null,
      storageDestinationId: dto.destinationId ?? null,
    });
    const saved = await this.registries.repo.save(entity);
    return { registry: this.registries.toDto(saved), username, password };
  }
}
