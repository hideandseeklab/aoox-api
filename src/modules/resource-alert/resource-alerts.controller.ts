import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApplicationService } from '../application/application.service';
import { ApplicationParamsDto } from '../application/get-application/get-application.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { DatabaseParamsDto } from '../managed-database/get-database/get-database.dto';
import { ManagedDatabaseService } from '../managed-database/managed-database.service';
import {
  ALERT_METRICS,
  ResourceAlertService,
  type ResourceAlertsView,
} from './resource-alert.service';
import { UpdateResourceAlertsDto } from './update-resource-alerts/update-resource-alerts.dto';

/**
 * Alert rules of one application. Reads need project access; the PUT is a write,
 * so viewers get 403 from the project access check like every other write.
 */
@Controller('applications')
@UseGuards(JwtAuthGuard)
export class ApplicationResourceAlertsController {
  constructor(
    private readonly applications: ApplicationService,
    private readonly alerts: ResourceAlertService,
  ) {}

  @Get(':id/alerts')
  async get(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
  ): Promise<ResourceAlertsView> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    return this.alerts.view(
      { kind: 'application', id: app.id },
      { cpuMillicores: app.cpuMillicores, memoryMb: app.memoryMb },
    );
  }

  @Put(':id/alerts')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
    @Body() dto: UpdateResourceAlertsDto,
  ): Promise<ResourceAlertsView> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    const owner = { kind: 'application', id: app.id } as const;
    for (const metric of ALERT_METRICS)
      if (dto[metric]) await this.alerts.saveRule(owner, metric, dto[metric]);
    return this.alerts.view(owner, {
      cpuMillicores: app.cpuMillicores,
      memoryMb: app.memoryMb,
    });
  }
}

/** Same for a managed database. */
@Controller('databases')
@UseGuards(JwtAuthGuard)
export class DatabaseResourceAlertsController {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly alerts: ResourceAlertService,
  ) {}

  @Get(':id/alerts')
  async get(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
  ): Promise<ResourceAlertsView> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    return this.alerts.view(
      { kind: 'database', id: db.id },
      { cpuMillicores: db.cpuMillicores, memoryMb: db.memoryMb },
    );
  }

  @Put(':id/alerts')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
    @Body() dto: UpdateResourceAlertsDto,
  ): Promise<ResourceAlertsView> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    const owner = { kind: 'database', id: db.id } as const;
    for (const metric of ALERT_METRICS)
      if (dto[metric]) await this.alerts.saveRule(owner, metric, dto[metric]);
    return this.alerts.view(owner, {
      cpuMillicores: db.cpuMillicores,
      memoryMb: db.memoryMb,
    });
  }
}
