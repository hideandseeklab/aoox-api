import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { SwarmNodeInfo, SwarmService } from '../swarm.service';
import { NodeParamsDto, UpdateNodeDto } from './update-node.dto';

@Controller('swarm/nodes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class UpdateNodeController {
  constructor(private readonly swarm: SwarmService) {}

  /** Drain/activate a node or promote/demote it. */
  @Patch(':id')
  update(
    @Param() params: NodeParamsDto,
    @Body() dto: UpdateNodeDto,
  ): Promise<SwarmNodeInfo> {
    return this.swarm.updateNode(params.id, dto);
  }
}
