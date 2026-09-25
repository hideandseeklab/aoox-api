import {
  Controller,
  Delete,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ApiTokenService } from '../api-token.service';

class ApiTokenParamsDto {
  @IsUUID()
  id: string;
}

@ApiTags('api-tokens')
@ApiBearerAuth()
@Controller('api-tokens')
@UseGuards(JwtAuthGuard)
export class DeleteApiTokenController {
  constructor(private readonly tokens: ApiTokenService) {}

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a token (takes effect immediately)' })
  async remove(
    @CurrentUser() user: JwtPayload & { tokenId?: string },
    @Param() params: ApiTokenParamsDto,
  ): Promise<void> {
    // Revoking is credential management, like creating: session only.
    if (user.tokenId) {
      throw new ForbiddenException(
        'API tokens cannot revoke tokens; sign in to manage them',
      );
    }
    const token = await this.tokens.repo.findOne({
      where: { id: params.id, userId: user.sub },
    });
    if (!token) throw new NotFoundException('Token not found');
    await this.tokens.repo.remove(token);
  }
}
