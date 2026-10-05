import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { DomainDto } from '../domain-dto';
import { UpdateDomainDto, UpdateDomainParamsDto } from './update-domain.dto';
import { UpdateDomainService } from './update-domain.service';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class UpdateDomainController {
  constructor(private readonly service: UpdateDomainService) {}

  @Patch(':id/domains/:domainId')
  update(
    @CurrentUser() user: JwtPayload,
    @Param() params: UpdateDomainParamsDto,
    @Body() dto: UpdateDomainDto,
  ): Promise<DomainDto> {
    return this.service.execute(user.sub, params.id, params.domainId, dto);
  }
}
