import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  DEFAULT_MAINTENANCE_MESSAGE,
  normalizeMaintenanceMessage,
} from '../../maintenance-mode/maintenance-page';
import { MaintenanceModeService } from '../../maintenance-mode/maintenance-mode.service';
import { ApplicationService } from '../application.service';
import { SetMaintenanceDto } from './set-maintenance.dto';

export interface MaintenanceView {
  enabled: boolean;
  /** The message as stored (null = the default message is shown). */
  message: string | null;
  /** The text the page shows right now. */
  effectiveMessage: string;
}

@Injectable()
export class SetMaintenanceService {
  private readonly logger = new Logger(SetMaintenanceService.name);

  constructor(
    private readonly applications: ApplicationService,
    private readonly maintenance: MaintenanceModeService,
  ) {}

  async execute(
    ownerId: string,
    applicationId: string,
    dto: SetMaintenanceDto,
  ): Promise<MaintenanceView> {
    const app = await this.applications.findOwnedOrFail(applicationId, ownerId);
    if (dto.enabled && app.serverId) {
      throw new BadRequestException(
        'Maintenance mode is not supported for applications on a remote server yet',
      );
    }
    const message = normalizeMaintenanceMessage(dto.message);
    const previous = {
      maintenanceEnabled: app.maintenanceEnabled,
      maintenanceMessage: app.maintenanceMessage,
    };
    // `update`, not `save`: a deploy or another request may be writing the row.
    await this.applications.repo.update(app.id, {
      maintenanceEnabled: dto.enabled,
      maintenanceMessage: message,
    });
    try {
      if (dto.enabled) {
        await this.maintenance.refresh(app.id);
      } else {
        await this.maintenance.deactivate(app.id);
      }
    } catch (err) {
      // Keep the flag in line with what the proxy really does.
      await this.applications.repo.update(app.id, previous);
      this.logger.warn(
        `Maintenance mode for ${app.appName} failed: ${String(err)}`,
      );
      throw new BadGatewayException(
        'The maintenance page could not be written to the proxy, so the setting was not changed; try again',
      );
    }
    return {
      enabled: dto.enabled,
      message,
      effectiveMessage: message ?? DEFAULT_MAINTENANCE_MESSAGE,
    };
  }
}
