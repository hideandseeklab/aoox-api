import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { SecretConnectionParamsDto } from '../delete-secret-connection/delete-secret-connection.controller';
import { SecretSourceService } from '../secret-source.service';

@Controller('secret-connections')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class TestSecretConnectionController {
  constructor(private readonly secrets: SecretSourceService) {}

  /** Universal Auth login only; the answer never contains a credential. */
  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  test(
    @Param() params: SecretConnectionParamsDto,
  ): Promise<{ ok: boolean; message: string }> {
    return this.secrets.test(params.id);
  }
}
