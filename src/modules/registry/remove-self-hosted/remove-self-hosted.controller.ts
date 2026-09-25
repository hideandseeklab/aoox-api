import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { RemoveSelfHostedQueryDto } from './remove-self-hosted.dto';
import { RemoveSelfHostedService } from './remove-self-hosted.service';

@Controller('registries')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class RemoveSelfHostedController {
  constructor(private readonly service: RemoveSelfHostedService) {}

  @Delete('self-hosted')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Query() query: RemoveSelfHostedQueryDto): Promise<void> {
    return this.service.execute(query.purge === 'true');
  }
}
