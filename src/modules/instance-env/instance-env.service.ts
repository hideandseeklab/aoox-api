import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  COMPOSE_FILES_SCRIPT,
  envUpsertLine,
  runComposeHelper,
} from '../docker/compose-apply.util';
import { DockerService } from '../docker/docker.service';
import { DEFAULT_TERMINAL_SSH_USER } from '../terminal/terminal-backend.service';
import { UpdateInstanceEnvDto } from './update-instance-env.dto';

/** DTO field -> the `.env.dist` key it maps to; also the whitelist of what this feature may ever touch. */
const ENV_KEYS = {
  terminalSshHost: 'TERMINAL_SSH_HOST',
  terminalSshPort: 'TERMINAL_SSH_PORT',
  terminalSshUser: 'TERMINAL_SSH_USER',
  terminalSshPassword: 'TERMINAL_SSH_PASSWORD',
  publicIp: 'PUBLIC_IP',
  registryPublicHost: 'REGISTRY_PUBLIC_HOST',
} as const;

export interface InstanceEnvStatus {
  installDirConfigured: boolean;
  terminalSshHost: string | null;
  terminalSshPort: string | null;
  /** Raw value from `.env.dist` (null when unset/empty). */
  terminalSshUser: string | null;
  /** What the terminal logs in as when `terminalSshUser` is empty. */
  terminalSshUserDefault: string;
  /** Never the actual value — same reason notification/webhook DTOs never carry secrets. */
  terminalSshPasswordSet: boolean;
  publicIp: string | null;
  registryPublicHost: string | null;
}

/**
 * Lets the owner set a handful of instance-wide env vars (currently: the
 * terminal's SSH-to-host credentials, `PUBLIC_IP`, `REGISTRY_PUBLIC_HOST`)
 * from the dashboard instead of hand-editing `.env.dist` over SSH — same
 * `INSTALL_DIR` + detached `docker compose up` pattern as panel-domain and
 * instance-update (this recreates the `api` container itself, since that's
 * the only service any of these variables are wired into).
 */
@Injectable()
export class InstanceEnvService {
  private readonly logger = new Logger(InstanceEnvService.name);

  constructor(
    private readonly docker: DockerService,
    private readonly config: ConfigService,
  ) {}

  private get installDir(): string | null {
    return this.config.get<string>('INSTALL_DIR')?.trim() || null;
  }

  status(): InstanceEnvStatus {
    return {
      installDirConfigured: this.installDir !== null,
      terminalSshHost: this.config.get<string>('TERMINAL_SSH_HOST') || null,
      terminalSshPort: this.config.get<string>('TERMINAL_SSH_PORT') || null,
      terminalSshUser: this.config.get<string>('TERMINAL_SSH_USER') || null,
      terminalSshUserDefault: DEFAULT_TERMINAL_SSH_USER,
      terminalSshPasswordSet: !!this.config.get<string>(
        'TERMINAL_SSH_PASSWORD',
      ),
      publicIp: this.config.get<string>('PUBLIC_IP') || null,
      registryPublicHost:
        this.config.get<string>('REGISTRY_PUBLIC_HOST') || null,
    };
  }

  update(dto: UpdateInstanceEnvDto): void {
    const installDir = this.installDir;
    if (!installDir) {
      throw new BadRequestException(
        'INSTALL_DIR is not set — add INSTALL_DIR=<absolute path of the folder ' +
          'holding docker-compose.dist.yml on this host> to .env.dist and restart, ' +
          'then try again',
      );
    }

    const upserts: string[] = [];
    for (const [field, key] of Object.entries(ENV_KEYS) as [
      keyof UpdateInstanceEnvDto,
      string,
    ][]) {
      const value = dto[field];
      if (value === undefined) continue;
      upserts.push(envUpsertLine(key, String(value).trim()));
    }
    if (upserts.length === 0) return;

    // Detached: if TERMINAL_SSH_* changed, the compose apply below recreates
    // this very container.
    setTimeout(() => {
      this.apply(installDir, upserts).catch((err: unknown) => {
        this.logger.error(`Applying instance env failed: ${String(err)}`);
      });
    }, 1500);
  }

  private async apply(installDir: string, upserts: string[]): Promise<void> {
    const script = [
      'set -e',
      `cd ${installDir}`,
      ...upserts,
      ...COMPOSE_FILES_SCRIPT,
      'docker compose $FILES --env-file .env.dist up -d',
    ].join('\n');

    await runComposeHelper(this.docker, installDir, script);
  }
}
