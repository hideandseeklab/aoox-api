import {
  ConflictException,
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
import { RemoteDockerService } from '../remote-docker.service';
import { ServerService } from '../server.service';
import { DeleteServerParamsDto } from './delete-server.dto';

@Controller('servers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class DeleteServerController {
  constructor(
    private readonly servers: ServerService,
    private readonly remote: RemoteDockerService,
  ) {}

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param() params: DeleteServerParamsDto): Promise<void> {
    const s = await this.servers.findOrFail(params.id);
    this.remote.forget(s.id);
    try {
      await this.servers.repo.remove(s);
    } catch (err) {
      // FK RESTRICT from applications.server_id
      if ((err as { code?: string }).code === '23503') {
        throw new ConflictException(
          'Server still has applications; move or delete them first',
        );
      }
      throw err;
    }
  }
}
