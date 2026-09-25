import {
  Body,
  ConflictException,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { CleanupReport, MaintenanceService } from '../maintenance.service';
import { RunCleanupDto } from './run-cleanup.dto';

/** Runs synchronously (seconds to a minute); 409 while another run is active. */
@ApiTags('maintenance')
@ApiBearerAuth()
@Controller('maintenance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class RunCleanupController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Post('cleanup')
  @ApiOperation({
    summary: 'Prune old deployment images, dangling images, build cache',
  })
  async run(@Body() dto: RunCleanupDto): Promise<CleanupReport> {
    if (this.maintenance.isRunning) {
      throw new ConflictException('Cleanup is already running');
    }
    return this.maintenance.cleanup({
      registryGc: dto.registryGc ?? true,
      pruneVolumes: dto.pruneVolumes ?? false,
    });
  }
}
