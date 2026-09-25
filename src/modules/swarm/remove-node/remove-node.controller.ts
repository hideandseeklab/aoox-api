import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { SwarmService } from '../swarm.service';
import { NodeParamsDto } from '../update-node/update-node.dto';
import { RemoveNodeQueryDto } from './remove-node.dto';

@Controller('swarm/nodes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class RemoveNodeController {
  constructor(private readonly swarm: SwarmService) {}

  /** Removes a (drained/down) node from the cluster; `?force=true` for a live one. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param() params: NodeParamsDto,
    @Query() query: RemoveNodeQueryDto,
  ): Promise<void> {
    return this.swarm.removeNode(params.id, query.force === 'true');
  }
}
