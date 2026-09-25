import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ComposeApp } from '../compose-app.entity';
import { CreateComposeAppDto } from './create-compose-app.dto';
import { CreateComposeAppService } from './create-compose-app.service';

@Controller('compose-apps')
@UseGuards(JwtAuthGuard)
export class CreateComposeAppController {
  constructor(private readonly service: CreateComposeAppService) {}

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateComposeAppDto,
  ): Promise<ComposeApp> {
    return this.service.execute(user.sub, dto);
  }
}
