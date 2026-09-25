import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { Application } from '../application.entity';
import { CreateApplicationDto } from './create-application.dto';
import { CreateApplicationService } from './create-application.service';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class CreateApplicationController {
  constructor(private readonly service: CreateApplicationService) {}

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateApplicationDto,
  ): Promise<Application> {
    return this.service.execute(user.sub, dto);
  }
}
