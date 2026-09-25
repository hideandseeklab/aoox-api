import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { DiskUsage, MaintenanceService } from '../maintenance.service';

@ApiTags('maintenance')
@ApiBearerAuth()
@Controller('maintenance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class DiskUsageController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get('disk')
  @ApiOperation({
    summary: 'Docker disk usage, reclaimable estimate, last cleanup',
  })
  async disk(): Promise<DiskUsage & { running: boolean }> {
    return {
      ...(await this.maintenance.usage()),
      running: this.maintenance.isRunning,
    };
  }
}
