import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { DeleteProjectParamsDto } from './delete-project.dto';
import { DeleteProjectService } from './delete-project.service';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class DeleteProjectController {
  constructor(private readonly service: DeleteProjectService) {}

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: JwtPayload,
    @Param() params: DeleteProjectParamsDto,
  ): Promise<void> {
    return this.service.execute(user.sub, params.id);
  }
}
