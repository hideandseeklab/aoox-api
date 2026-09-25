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
import {
  TestRegistryParamsDto,
  TestRegistryResponseDto,
} from './test-registry.dto';
import { TestRegistryService } from './test-registry.service';

@Controller('registries')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class TestRegistryController {
  constructor(private readonly service: TestRegistryService) {}

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  test(
    @Param() params: TestRegistryParamsDto,
  ): Promise<TestRegistryResponseDto> {
    return this.service.execute(params.id);
  }
}
