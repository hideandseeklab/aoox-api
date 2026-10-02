import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ApplicationParamsDto } from '../get-application/get-application.dto';
import { SecretSourceAppService } from './secret-source-app.service';
import { SecretSourceView } from './secret-source-view';
import { UpdateSecretSourceDto } from './update-secret-source.dto';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class SecretSourceAppController {
  constructor(private readonly service: SecretSourceAppService) {}

  @Put(':id/secret-source')
  update(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
    @Body() dto: UpdateSecretSourceDto,
  ): Promise<{ secretSource: SecretSourceView | null }> {
    return this.service.update(user.sub, params.id, dto);
  }

  /** Key names only. A POST (it logs in), so it counts as a write: viewers get 403. */
  @Post(':id/secret-source/preview')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  preview(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
  ): Promise<{ keys: string[] }> {
    return this.service.preview(user.sub, params.id);
  }
}
