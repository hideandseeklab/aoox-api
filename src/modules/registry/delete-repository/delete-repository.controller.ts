import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import {
  DeleteRepositoryParamsDto,
  DeleteRepositoryQueryDto,
  DeleteRepositoryResponseDto,
  RepositoryUsageDto,
} from './delete-repository.dto';
import { DeleteRepositoryService } from './delete-repository.service';

// Same role scope as delete-tag: this deletes one repository's manifests
// (bulk delete-tag + folder cleanup + GC), not the shared registry-wide GC
// button, which stays owner-only.
@Controller('registries')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class DeleteRepositoryController {
  constructor(private readonly service: DeleteRepositoryService) {}

  @Get(':id/repositories/*repository/usage')
  usage(
    @Param() params: DeleteRepositoryParamsDto,
  ): Promise<RepositoryUsageDto[]> {
    return this.service.usage(params.repository);
  }

  @Delete(':id/repositories/*repository')
  @HttpCode(HttpStatus.OK)
  remove(
    @Param() params: DeleteRepositoryParamsDto,
    @Query() query: DeleteRepositoryQueryDto,
  ): Promise<DeleteRepositoryResponseDto> {
    return this.service.execute(
      params.id,
      params.repository,
      query.force === 'true',
    );
  }
}
