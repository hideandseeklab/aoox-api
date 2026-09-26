import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RegistryClient } from './registry-client';
import { decryptSecret, encryptSecret } from '../docker/secret.util';
import { Registry } from './registry.entity';

/** Public shape (never includes the password). */
export interface RegistryDto {
  id: string;
  name: string;
  type: Registry['type'];
  url: string;
  username: string | null;
  imagePrefix: string | null;
  domain: string | null;
  storageDestinationId: string | null;
  createdAt: Date;
}

@Injectable()
export class RegistryService {
  private readonly encryptionKey: string;

  constructor(
    @InjectRepository(Registry)
    readonly repo: Repository<Registry>,
    private readonly config: ConfigService,
  ) {
    this.encryptionKey = config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  toDto(r: Registry): RegistryDto {
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      url: r.url,
      username: r.username,
      imagePrefix: r.imagePrefix,
      domain: r.domain,
      storageDestinationId: r.storageDestinationId,
      createdAt: r.createdAt,
    };
  }

  encryptPassword(plain: string): string {
    return encryptSecret(plain, this.encryptionKey);
  }

  async findOrFail(id: string): Promise<Registry> {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Registry not found');
    return r;
  }

  /** Loads the registry including its decrypted password. */
  async findWithPassword(
    id: string,
  ): Promise<{ registry: Registry; password: string | null }> {
    const registry = await this.repo
      .createQueryBuilder('r')
      .addSelect('r.passwordEncrypted')
      .where('r.id = :id', { id })
      .getOne();
    if (!registry) throw new NotFoundException('Registry not found');
    const password = registry.passwordEncrypted
      ? decryptSecret(registry.passwordEncrypted, this.encryptionKey)
      : null;
    return { registry, password };
  }

  findSelfHosted(): Promise<Registry | null> {
    return this.repo.findOne({ where: { type: 'self-hosted' } });
  }

  /** HTTP client for the registry as reachable from the API process. */
  async clientFor(id: string): Promise<RegistryClient> {
    const { registry, password } = await this.findWithPassword(id);
    return new RegistryClient(this.apiBaseUrl(registry), {
      username: registry.username,
      password,
    });
  }

  /**
   * External registries are always https. The self-hosted one is plain http
   * and, when the API runs in Docker, must be reached via REGISTRY_INTERNAL_URL
   * (e.g. http://host.docker.internal:5000) rather than the advertised host.
   */
  apiBaseUrl(registry: Registry): string {
    if (registry.type === 'self-hosted') {
      return (
        this.config.get<string>('REGISTRY_INTERNAL_URL') ??
        `http://${registry.url}`
      );
    }
    return registry.url.startsWith('http')
      ? registry.url
      : `https://${registry.url}`;
  }
}
