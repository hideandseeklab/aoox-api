import { BadRequestException, Injectable } from '@nestjs/common';
import { ApplicationService } from '../../application/application.service';
import { HttpMonitorService, type MonitorView } from '../http-monitor.service';
import { parseExpectedCodes, validateMonitorPath } from '../http-probe';
import { UpdateHttpMonitorDto } from './update-http-monitor.dto';

@Injectable()
export class UpdateHttpMonitorService {
  constructor(
    private readonly applications: ApplicationService,
    private readonly monitors: HttpMonitorService,
  ) {}

  async execute(
    userId: string,
    applicationId: string,
    dto: UpdateHttpMonitorDto,
  ): Promise<MonitorView> {
    const app = await this.applications.findOwnedOrFail(applicationId, userId);
    const input: Partial<MonitorView['config']> = { ...dto };
    if (dto.path !== undefined) {
      const error = validateMonitorPath(dto.path);
      if (error) throw new BadRequestException(error);
    }
    if (dto.expectedCodes !== undefined) {
      const normalized = dto.expectedCodes.replace(/\s+/g, '');
      if (!parseExpectedCodes(normalized))
        throw new BadRequestException(
          'expectedCodes must be codes 100-599 or ranges like 200-399',
        );
      input.expectedCodes = normalized;
    }
    await this.monitors.saveConfig(app, input);
    return this.monitors.view(app);
  }
}
