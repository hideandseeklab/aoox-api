import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import {
  GitCredentialDto,
  GitCredentialService,
} from '../git-credential.service';

@Controller('git-credentials')
@UseGuards(JwtAuthGuard)
export class ListGitCredentialsController {
  constructor(private readonly credentials: GitCredentialService) {}

  @Get()
  async list(): Promise<GitCredentialDto[]> {
    const rows = await this.credentials.repo.find({
      order: { createdAt: 'ASC' },
    });
    return rows.map((r) => this.credentials.toDto(r));
  }
}
