import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ComposeApp } from '../compose-app.entity';
import { CreateFromTemplateDto } from './create-from-template.dto';
import { CreateFromTemplateService } from './create-from-template.service';

/** Creates the stack and queues its first deploy (202; poll GET /compose-apps/:id). */
@Controller('compose-apps')
@UseGuards(JwtAuthGuard)
export class CreateFromTemplateController {
  constructor(private readonly service: CreateFromTemplateService) {}

  @Post('from-template')
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateFromTemplateDto,
  ): Promise<ComposeApp> {
    return this.service.execute(user.sub, dto);
  }
}
