import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ILike, LessThan } from 'typeorm';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { AuditLog } from '../audit-log.entity';
import { AuditLogService } from '../audit-log.service';
import { ListAuditLogsQueryDto } from './list-audit-logs.dto';

@ApiTags('audit-logs')
@ApiBearerAuth()
@Controller('audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class ListAuditLogsController {
  constructor(private readonly audit: AuditLogService) {}

  @Get()
  @ApiOperation({ summary: 'Newest audit entries first (cursor: `before`)' })
  list(@Query() q: ListAuditLogsQueryDto): Promise<AuditLog[]> {
    return this.audit.repo.find({
      where: {
        ...(q.before ? { createdAt: LessThan(new Date(q.before)) } : {}),
        ...(q.actorId ? { actorId: q.actorId } : {}),
        ...(q.action ? { action: ILike(`%${q.action}%`) } : {}),
      },
      order: { createdAt: 'DESC' },
      take: q.limit ?? 50,
    });
  }
}
