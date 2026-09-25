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
import { NotificationService } from '../notification.service';
import { DeleteNotificationParamsDto } from './delete-notification.dto';

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class DeleteNotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param() params: DeleteNotificationParamsDto): Promise<void> {
    const n = await this.notifications.findOrFail(params.id);
    await this.notifications.repo.remove(n);
  }
}
