import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsObject, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import {
  buildPreset,
  PresetInfo,
  PresetResult,
  PRESETS,
} from '../proxy-config-presets';

export class PresetParamDto {
  @IsString()
  preset: string;
}

export class RenderPresetDto {
  /** The preset form values (see `GET /proxy/config/presets`). */
  @IsObject()
  params: Record<string, unknown>;
}

@Controller('proxy/config/presets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class ProxyConfigPresetsController {
  @Get()
  list(): PresetInfo[] {
    return PRESETS;
  }

  /**
   * Only builds YAML from the form values; nothing is stored. Owner only
   * because it hashes a password; the password never leaves this request and
   * the audit log redacts the `password` key.
   */
  @Post(':preset')
  @HttpCode(200)
  @Roles('owner')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  render(
    @Param() p: PresetParamDto,
    @Body() dto: RenderPresetDto,
  ): Promise<PresetResult> {
    return buildPreset(p.preset, dto.params);
  }
}
