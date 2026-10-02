import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  UseGuards,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { SecretSourceService } from '../secret-source.service';

export class SecretConnectionParamsDto {
  @IsUUID()
  id: string;
}

@Controller('secret-connections')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class DeleteSecretConnectionController {
  constructor(private readonly secrets: SecretSourceService) {}

  /** Applications that used it lose their source (FK SET NULL); their next deploy no longer injects. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param() params: SecretConnectionParamsDto): Promise<void> {
    const c = await this.secrets.findOrFail(params.id);
    await this.secrets.repo.remove(c);
  }
}
