import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DockerService } from '../../docker/docker.service';
import { ProxyService, ProxyStatus } from '../proxy.service';

@Injectable()
export class ProvisionProxyService {
  constructor(
    private readonly docker: DockerService,
    private readonly proxy: ProxyService,
  ) {}

  async execute(): Promise<ProxyStatus> {
    if (!(await this.docker.ping())) {
      throw new ServiceUnavailableException('Docker engine is not reachable');
    }
    if ((await this.proxy.status()).installed) {
      throw new ConflictException('Proxy is already installed');
    }
    await this.proxy.provision();
    return this.proxy.status();
  }
}
