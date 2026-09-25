import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { GitCredentialDto } from '../git-credential.service';
import { CreateGitCredentialDto } from './create-git-credential.dto';
import { CreateGitCredentialService } from './create-git-credential.service';

@Controller('git-credentials')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class CreateGitCredentialController {
  constructor(private readonly service: CreateGitCredentialService) {}

  @Post()
  create(@Body() dto: CreateGitCredentialDto): Promise<GitCredentialDto> {
    return this.service.execute(dto);
  }
}
