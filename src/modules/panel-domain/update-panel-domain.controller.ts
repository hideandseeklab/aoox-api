import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PanelDomainSettings } from './panel-domain-settings.entity';
import { PanelDomainService } from './panel-domain.service';
import { UpdatePanelDomainDto } from './update-panel-domain.dto';

@Controller('instance/domain')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class UpdatePanelDomainController {
  constructor(private readonly panelDomain: PanelDomainService) {}

  // Recreates the panel's own containers — not something to brute-force.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Patch()
  @HttpCode(HttpStatus.ACCEPTED)
  update(@Body() dto: UpdatePanelDomainDto): Promise<PanelDomainSettings> {
    return this.panelDomain.update(dto);
  }
}
