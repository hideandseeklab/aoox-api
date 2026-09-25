import {
  Body,
  Controller,
  ForbiddenException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ProjectAccessService } from '../../project/project-access.service';
import { ApiToken } from '../api-token.entity';
import { ApiTokenService } from '../api-token.service';
import { CreateApiTokenDto } from './create-api-token.dto';

export interface CreatedApiToken extends Omit<ApiToken, 'tokenHash' | 'user'> {
  /** Shown once; only its hash is kept. */
  token: string;
}

@ApiTags('api-tokens')
@ApiBearerAuth()
@Controller('api-tokens')
@UseGuards(JwtAuthGuard)
export class CreateApiTokenController {
  constructor(
    private readonly tokens: ApiTokenService,
    private readonly access: ProjectAccessService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create a personal access token',
    description:
      'The plaintext token is returned once. Use it as `Authorization: Bearer aoox_…`; it acts as your user with the same role.',
  })
  async create(
    @CurrentUser() user: JwtPayload & { tokenId?: string },
    @Body() dto: CreateApiTokenDto,
  ): Promise<CreatedApiToken> {
    // A scoped token must not be able to mint an unscoped one.
    if (user.tokenId) {
      throw new ForbiddenException(
        'API tokens cannot create tokens; sign in to manage them',
      );
    }
    const expiresAt = dto.expiresInDays
      ? new Date(Date.now() + dto.expiresInDays * 86_400_000)
      : null;
    // A scope that names projects the creator cannot see would grant nothing.
    const projectIds = dto.projectIds?.length
      ? await this.accessibleOrFail(user.sub, dto.projectIds)
      : null;
    const { token, plaintext } = await this.tokens.create(
      user.sub,
      dto.name.trim(),
      expiresAt,
      { readOnly: dto.readOnly, projectIds },
    );
    return { ...token, token: plaintext };
  }

  private async accessibleOrFail(
    userId: string,
    ids: string[],
  ): Promise<string[]> {
    const accessible = await this.access.accessibleProjectIds(userId);
    if (accessible === 'all') return ids;
    const missing = ids.filter((id) => !accessible.includes(id));
    if (missing.length) {
      throw new ForbiddenException(
        `You cannot grant access to project(s) you do not have: ${missing.join(', ')}`,
      );
    }
    return ids;
  }
}
