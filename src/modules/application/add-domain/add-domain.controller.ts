import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { Domain } from '../domain.entity';
import { ApplicationParamsDto } from '../get-application/get-application.dto';
import { AddDomainDto } from './add-domain.dto';
import { AddDomainService } from './add-domain.service';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class AddDomainController {
  constructor(private readonly service: AddDomainService) {}

  @Post(':id/domains')
  add(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
    @Body() dto: AddDomainDto,
  ): Promise<Domain> {
    return this.service.execute(user.sub, params.id, dto);
  }
}
