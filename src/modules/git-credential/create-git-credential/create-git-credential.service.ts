import { Injectable } from '@nestjs/common';
import {
  GitCredentialDto,
  GitCredentialService,
} from '../git-credential.service';
import { CreateGitCredentialDto } from './create-git-credential.dto';

@Injectable()
export class CreateGitCredentialService {
  constructor(private readonly credentials: GitCredentialService) {}

  async execute(dto: CreateGitCredentialDto): Promise<GitCredentialDto> {
    const entity = this.credentials.repo.create({
      name: dto.name.trim(),
      provider: dto.provider,
      username: dto.username.trim(),
      tokenEncrypted: this.credentials.encrypt(dto.token.trim()),
    });
    return this.credentials.toDto(await this.credentials.repo.save(entity));
  }
}
