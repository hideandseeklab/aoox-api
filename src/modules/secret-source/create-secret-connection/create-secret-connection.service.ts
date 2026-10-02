import { ConflictException, Injectable } from '@nestjs/common';
import {
  SecretConnectionDto,
  SecretSourceService,
} from '../secret-source.service';
import { CreateSecretConnectionDto } from './create-secret-connection.dto';

@Injectable()
export class CreateSecretConnectionService {
  constructor(private readonly secrets: SecretSourceService) {}

  async execute(dto: CreateSecretConnectionDto): Promise<SecretConnectionDto> {
    const name = dto.name.trim();
    if (await this.secrets.repo.exists({ where: { name } })) {
      throw new ConflictException(
        `A connection named "${name}" already exists`,
      );
    }
    const entity = this.secrets.repo.create({
      name,
      provider: 'infisical',
      url: dto.url?.trim().replace(/\/+$/, '') || null,
      clientId: dto.clientId.trim(),
      clientSecretEncrypted: this.secrets.encrypt(dto.clientSecret.trim()),
    });
    return this.secrets.toDto(await this.secrets.repo.save(entity));
  }
}
