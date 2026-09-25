import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { TestServerParamsDto, TestServerResponseDto } from './test-server.dto';
import { TestServerService } from './test-server.service';

@Controller('servers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class TestServerController {
  constructor(private readonly service: TestServerService) {}

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  test(@Param() params: TestServerParamsDto): Promise<TestServerResponseDto> {
    return this.service.execute(params.id);
  }
}
