import {
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import {
  DockerTargetQueryDto,
  PruneImagesResultDto,
} from '../docker-manager.dto';
import { RemoveImageService } from './remove-image.service';

@Controller('docker/images')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class RemoveImageController {
  constructor(private readonly service: RemoveImageService) {}

  // Declared before ':id' so "prune" is never read as an image id.
  @Post('prune')
  @HttpCode(200)
  prune(@Query() q: DockerTargetQueryDto): Promise<PruneImagesResultDto> {
    return this.service.pruneDangling(q.serverId);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @Query() q: DockerTargetQueryDto) {
    return this.service.remove(id, q.serverId);
  }
}
