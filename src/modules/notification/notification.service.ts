import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { decryptSecret, encryptSecret } from '../docker/secret.util';
import { NotificationMessage, sendNotification } from './notification-sender';
import { Notification, NotificationConfig } from './notification.entity';

/** Public shape: never includes tokens or webhook URLs, only a masked hint. */
export interface NotificationDto {
  id: string;
  name: string;
  type: Notification['type'];
  /** e.g. `chat 12345…` or `hooks.slack.com/…`, for recognition only. */
  targetHint: string;
  onDeploymentSuccess: boolean;
  onDeploymentFailure: boolean;
  onBackupFailure: boolean;
  onJobFailure: boolean;
  onContainerDown: boolean;
  onDiskLow: boolean;
  onCertificateFailure: boolean;
  onDnsIssue: boolean;
  createdAt: Date;
}

export type NotificationEvent =
  | 'deploymentSuccess'
  | 'deploymentFailure'
  | 'backupFailure'
  | 'jobFailure'
  | 'containerDown'
  | 'diskLow'
  | 'certificateFailure'
  | 'dnsIssue';

const EVENT_TOGGLE: Record<NotificationEvent, keyof Notification> = {
  deploymentSuccess: 'onDeploymentSuccess',
  deploymentFailure: 'onDeploymentFailure',
  backupFailure: 'onBackupFailure',
  jobFailure: 'onJobFailure',
  containerDown: 'onContainerDown',
  diskLow: 'onDiskLow',
  certificateFailure: 'onCertificateFailure',
  dnsIssue: 'onDnsIssue',
};

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly encryptionKey: string;

  constructor(
    @InjectRepository(Notification)
    readonly repo: Repository<Notification>,
    config: ConfigService,
  ) {
    this.encryptionKey = config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  toDto(n: Notification, config: NotificationConfig): NotificationDto {
    return {
      id: n.id,
      name: n.name,
      type: n.type,
      targetHint: NotificationService.hint(config),
      onDeploymentSuccess: n.onDeploymentSuccess,
      onDeploymentFailure: n.onDeploymentFailure,
      onBackupFailure: n.onBackupFailure,
      onJobFailure: n.onJobFailure,
      onContainerDown: n.onContainerDown,
      onDiskLow: n.onDiskLow,
      onCertificateFailure: n.onCertificateFailure,
      onDnsIssue: n.onDnsIssue,
      createdAt: n.createdAt,
    };
  }

  encryptConfig(config: NotificationConfig): string {
    return encryptSecret(JSON.stringify(config), this.encryptionKey);
  }

  async findOrFail(id: string): Promise<Notification> {
    const n = await this.repo.findOne({ where: { id } });
    if (!n) throw new NotFoundException('Notification not found');
    return n;
  }

  /** All channels with their decrypted config (internal use only). */
  async listWithConfig(): Promise<
    Array<{ notification: Notification; config: NotificationConfig }>
  > {
    const rows = await this.repo
      .createQueryBuilder('n')
      .addSelect('n.configEncrypted')
      .orderBy('n.created_at', 'ASC')
      .getMany();
    return rows.map((notification) => ({
      notification,
      config: this.decode(notification),
    }));
  }

  async resolve(
    id: string,
  ): Promise<{ notification: Notification; config: NotificationConfig }> {
    const notification = await this.repo
      .createQueryBuilder('n')
      .addSelect('n.configEncrypted')
      .where('n.id = :id', { id })
      .getOne();
    if (!notification) throw new NotFoundException('Notification not found');
    return { notification, config: this.decode(notification) };
  }

  /**
   * Sends `message` to every channel subscribed to `event`. Failures are
   * logged per channel and never thrown — callers are fire-and-forget.
   */
  async broadcast(
    event: NotificationEvent,
    message: NotificationMessage,
  ): Promise<void> {
    const channels = await this.listWithConfig();
    await Promise.all(
      channels
        .filter(({ notification: n }) => n[EVENT_TOGGLE[event]] === true)
        .map(({ notification: n, config }) =>
          sendNotification(config, message).catch((err) =>
            this.logger.warn(
              `Notification "${n.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
            ),
          ),
        ),
    );
  }

  private decode(n: Notification): NotificationConfig {
    return JSON.parse(
      decryptSecret(n.configEncrypted, this.encryptionKey),
    ) as NotificationConfig;
  }

  static hint(config: NotificationConfig): string {
    switch (config.type) {
      case 'telegram':
        return `chat ${config.chatId}`;
      case 'slack':
      case 'discord':
        return hostPath(config.webhookUrl);
      case 'webhook':
        return hostPath(config.url);
      case 'email':
        return config.to.join(', ');
    }
  }
}

/** `https://hooks.slack.com/services/T000/B000/xxx` -> `hooks.slack.com/services/…` */
function hostPath(url: string): string {
  try {
    const u = new URL(url);
    const first = u.pathname.split('/').filter(Boolean)[0];
    return `${u.host}/${first ? `${first}/` : ''}…`;
  } catch {
    return '…';
  }
}
