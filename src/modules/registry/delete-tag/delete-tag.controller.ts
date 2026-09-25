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
import { DeleteTagParamsDto } from './delete-tag.dto';
import { DeleteTagService } from './delete-tag.service';

@Controller('registries')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class DeleteTagController {
  constructor(private readonly service: DeleteTagService) {}

  @Delete(':id/repositories/*repository/tags/:tag')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param() params: DeleteTagParamsDto): Promise<void> {
    return this.service.execute(params.id, params.repository, params.tag);
  }
}
