import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ApiToken } from '../api-token.entity';
import { ApiTokenService } from '../api-token.service';

@ApiTags('api-tokens')
@ApiBearerAuth()
@Controller('api-tokens')
@UseGuards(JwtAuthGuard)
export class ListApiTokensController {
  constructor(private readonly tokens: ApiTokenService) {}

  @Get()
  @ApiOperation({ summary: 'List your personal access tokens' })
  list(@CurrentUser() user: JwtPayload): Promise<ApiToken[]> {
    return this.tokens.repo.find({
      where: { userId: user.sub },
      order: { createdAt: 'DESC' },
    });
  }
}
