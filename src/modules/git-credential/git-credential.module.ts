import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CreateGitCredentialController } from './create-git-credential/create-git-credential.controller';
import { CreateGitCredentialService } from './create-git-credential/create-git-credential.service';
import { DeleteGitCredentialController } from './delete-git-credential/delete-git-credential.controller';
import { GitCredential } from './git-credential.entity';
import { GitCredentialService } from './git-credential.service';
import { ListGitCredentialsController } from './list-git-credentials/list-git-credentials.controller';

@Module({
  imports: [TypeOrmModule.forFeature([GitCredential])],
  controllers: [
    CreateGitCredentialController,
    ListGitCredentialsController,
    DeleteGitCredentialController,
  ],
  providers: [GitCredentialService, CreateGitCredentialService],
  exports: [GitCredentialService],
})
export class GitCredentialModule {}
