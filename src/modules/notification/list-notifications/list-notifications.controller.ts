import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import type { NotificationDto } from '../notification.service';
import { NotificationService } from '../notification.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class ListNotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  async list(): Promise<NotificationDto[]> {
    // Config is loaded only to derive the masked hint; it never leaves the API.
    const rows = await this.notifications.listWithConfig();
    return rows.map((r) => this.notifications.toDto(r.notification, r.config));
  }
}
