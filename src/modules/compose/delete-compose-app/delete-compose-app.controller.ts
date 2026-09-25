import {
  ConflictException,
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
import { ComposeAppParamsDto } from '../compose-app.dto';
import { ComposeRunnerService } from '../compose-runner.service';
import { ComposeService } from '../compose.service';

/** `compose down -v`, drops the checkout volume, then the row. Synchronous (can take a while). */
@Controller('compose-apps')
@UseGuards(JwtAuthGuard)
export class DeleteComposeAppController {
  constructor(
    private readonly compose: ComposeService,
    private readonly runner: ComposeRunnerService,
  ) {}

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param() params: ComposeAppParamsDto,
  ): Promise<void> {
    const app = await this.compose.findOwnedOrFail(params.id, user.sub);
    if (this.runner.isActive(app.id)) {
      throw new ConflictException('A compose action is still running');
    }
    await this.runner.destroy(app);
    await this.compose.repo.remove(app);
  }
}
