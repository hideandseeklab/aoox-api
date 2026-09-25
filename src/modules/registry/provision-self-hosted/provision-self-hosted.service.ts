import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DockerService } from '../../docker/docker.service';
import { RegistryService } from '../registry.service';
import { SelfHostedRegistryService } from '../self-hosted-registry.service';
import { ProvisionSelfHostedResponseDto } from './provision-self-hosted.dto';

@Injectable()
export class ProvisionSelfHostedService {
  constructor(
    private readonly docker: DockerService,
    private readonly selfHosted: SelfHostedRegistryService,
    private readonly registries: RegistryService,
  ) {}

  async execute(): Promise<ProvisionSelfHostedResponseDto> {
    if (!(await this.docker.ping())) {
      throw new ServiceUnavailableException('Docker engine is not reachable');
    }
    if (await this.registries.findSelfHosted()) {
      throw new ConflictException('Self-hosted registry already provisioned');
    }
    if ((await this.selfHosted.status()).installed) {
      throw new ConflictException(
        'A registry container already exists; remove it first',
      );
    }

    const { username, password } = await this.selfHosted.provision();
    const entity = this.registries.repo.create({
      name: 'Local registry',
      type: 'self-hosted',
      url: this.selfHosted.publicUrl,
      username,
      passwordEncrypted: this.registries.encryptPassword(password),
      imagePrefix: null,
    });
    const saved = await this.registries.repo.save(entity);
    return { registry: this.registries.toDto(saved), username, password };
  }
}
