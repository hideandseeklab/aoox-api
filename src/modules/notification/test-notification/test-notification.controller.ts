import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import {
  TestNotificationParamsDto,
  TestNotificationResponseDto,
} from './test-notification.dto';
import { TestNotificationService } from './test-notification.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class TestNotificationController {
  constructor(private readonly service: TestNotificationService) {}

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  test(
    @Param() params: TestNotificationParamsDto,
  ): Promise<TestNotificationResponseDto> {
    return this.service.execute(params.id);
  }
}
