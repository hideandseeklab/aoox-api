import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { BackupDestinationService } from '../backup-destination.service';

export class TestDestinationParamsDto {
  @IsUUID()
  id: string;
}

export class TestDestinationResponseDto {
  ok: boolean;
  message: string;
}

/** Lists the bucket prefix through rclone so the user can confirm access. */
@Controller('backup-destinations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class TestDestinationController {
  constructor(private readonly destinations: BackupDestinationService) {}

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  async test(
    @Param() params: TestDestinationParamsDto,
  ): Promise<TestDestinationResponseDto> {
    try {
      const { objects } = await this.destinations.test(params.id);
      return {
        ok: true,
        message: `Bucket reachable (${objects} object(s) under prefix)`,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
