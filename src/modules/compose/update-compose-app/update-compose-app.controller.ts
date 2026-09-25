import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ComposeAppFieldsDto, ComposeAppParamsDto } from '../compose-app.dto';
import { ComposeApp } from '../compose-app.entity';
import { UpdateComposeAppService } from './update-compose-app.service';

@Controller('compose-apps')
@UseGuards(JwtAuthGuard)
export class UpdateComposeAppController {
  constructor(private readonly service: UpdateComposeAppService) {}

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param() params: ComposeAppParamsDto,
    @Body() dto: ComposeAppFieldsDto,
  ): Promise<ComposeApp> {
    return this.service.execute(user.sub, params.id, dto);
  }
}
