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
import { ApplicationParamsDto } from '../get-application/get-application.dto';
import { DeleteApplicationService } from './delete-application.service';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class DeleteApplicationController {
  constructor(private readonly service: DeleteApplicationService) {}

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
  ): Promise<void> {
    return this.service.execute(user.sub, params.id);
  }
}
