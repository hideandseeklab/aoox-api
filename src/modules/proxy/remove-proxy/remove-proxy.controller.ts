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
import { ProxyService } from '../proxy.service';
import { RemoveProxyQueryDto } from './remove-proxy.dto';

@Controller('proxy')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class RemoveProxyController {
  constructor(private readonly proxy: ProxyService) {}

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Query() query: RemoveProxyQueryDto): Promise<void> {
    return this.proxy.remove(query.purge === 'true');
  }
}
