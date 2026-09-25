import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ApplicationParamsDto } from '../get-application/get-application.dto';
import { Mount } from '../mount.entity';
import { AddMountDto } from './add-mount.dto';
import { AddMountService } from './add-mount.service';

/** Adds a mount and re-creates the container so it takes effect right away. */
@Controller('applications')
@UseGuards(JwtAuthGuard)
export class AddMountController {
  constructor(private readonly service: AddMountService) {}

  @Post(':id/mounts')
  add(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
    @Body() dto: AddMountDto,
  ): Promise<Mount> {
    return this.service.execute(user, params.id, dto);
  }
}
