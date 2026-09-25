import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import type { NotificationDto } from '../notification.service';
import { CreateNotificationDto } from './create-notification.dto';
import { CreateNotificationService } from './create-notification.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class CreateNotificationController {
  constructor(private readonly service: CreateNotificationService) {}

  @Post()
  create(@Body() dto: CreateNotificationDto): Promise<NotificationDto> {
    return this.service.execute(dto);
  }
}
