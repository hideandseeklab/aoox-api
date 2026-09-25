import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { GitCredentialService } from '../git-credential.service';
import { DeleteGitCredentialParamsDto } from './delete-git-credential.dto';

@Controller('git-credentials')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class DeleteGitCredentialController {
  constructor(private readonly credentials: GitCredentialService) {}

  /** Applications referencing it fall back to an anonymous clone (FK SET NULL). */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param() params: DeleteGitCredentialParamsDto): Promise<void> {
    const c = await this.credentials.findOrFail(params.id);
    await this.credentials.repo.remove(c);
  }
}
