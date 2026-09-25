import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ApplicationParamsDto } from '../get-application/get-application.dto';
import { ImageCheckResult } from '../image-update-watcher.service';
import { CheckImageUpdateDto } from './check-image-update.dto';
import { CheckImageUpdateService } from './check-image-update.service';

/** Asks the registry whether the app's image tag changed; optionally deploys it. */
@Controller('applications')
@UseGuards(JwtAuthGuard)
export class CheckImageUpdateController {
  constructor(private readonly service: CheckImageUpdateService) {}

  @Post(':id/check-image')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  check(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
    @Body() dto: CheckImageUpdateDto,
  ): Promise<ImageCheckResult> {
    return this.service.execute(user.sub, params.id, dto.deploy ?? false);
  }
}
