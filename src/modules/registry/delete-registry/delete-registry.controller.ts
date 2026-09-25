import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { DeleteRegistryParamsDto } from './delete-registry.dto';
import { DeleteRegistryService } from './delete-registry.service';

@Controller('registries')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class DeleteRegistryController {
  constructor(private readonly service: DeleteRegistryService) {}

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param() params: DeleteRegistryParamsDto): Promise<void> {
    return this.service.execute(params.id);
  }
}
