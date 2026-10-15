import { Controller, Delete, HttpCode, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { MaintenanceService } from '../maintenance.service';
import { OrphanContainerParamsDto } from './remove-orphan-container.dto';

@ApiTags('maintenance')
@ApiBearerAuth()
@Controller('maintenance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class RemoveOrphanContainerController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Delete('orphan-containers/:id')
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Remove one leftover container (re-checked as an orphan first)',
  })
  async remove(@Param() params: OrphanContainerParamsDto): Promise<void> {
    await this.maintenance.removeOrphanContainer(params.id);
  }
}
