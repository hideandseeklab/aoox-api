import { Injectable } from '@nestjs/common';
import { RegistryDto, RegistryService } from '../registry.service';
import { CreateRegistryDto } from './create-registry.dto';

/** Registers an external registry (Docker Hub, GHCR, GitLab, ...). */
@Injectable()
export class CreateRegistryService {
  constructor(private readonly registries: RegistryService) {}

  async execute(dto: CreateRegistryDto): Promise<RegistryDto> {
    const entity = this.registries.repo.create({
      name: dto.name.trim(),
      type: 'external',
      url: dto.url.trim().replace(/\/+$/, ''),
      username: dto.username?.trim() || null,
      passwordEncrypted: dto.password
        ? this.registries.encryptPassword(dto.password)
        : null,
      imagePrefix: dto.imagePrefix?.trim() || null,
    });
    return this.registries.toDto(await this.registries.repo.save(entity));
  }
}
