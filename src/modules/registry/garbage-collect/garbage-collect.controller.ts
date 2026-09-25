import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import {
  GarbageCollectQueryDto,
  GarbageCollectResponseDto,
} from './garbage-collect.dto';
import { GarbageCollectService } from './garbage-collect.service';

@Controller('registries')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class GarbageCollectController {
  constructor(private readonly service: GarbageCollectService) {}

  @Post('self-hosted/garbage-collect')
  @HttpCode(HttpStatus.OK)
  run(
    @Query() query: GarbageCollectQueryDto,
  ): Promise<GarbageCollectResponseDto> {
    return this.service.execute(query.dryRun === 'true');
  }
}
