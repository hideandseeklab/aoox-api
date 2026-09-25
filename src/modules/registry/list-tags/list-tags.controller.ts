import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ListTagsParamsDto, TagDto } from './list-tags.dto';
import { ListTagsService } from './list-tags.service';

@Controller('registries')
@UseGuards(JwtAuthGuard)
export class ListTagsController {
  constructor(private readonly service: ListTagsService) {}

  // Repository names may contain slashes, hence the wildcard segment.
  @Get(':id/repositories/*repository/tags')
  list(@Param() params: ListTagsParamsDto): Promise<TagDto[]> {
    return this.service.execute(params.id, params.repository);
  }
}
