import { Injectable } from '@nestjs/common';
import { NotificationConfig } from '../notification.entity';
import { NotificationDto, NotificationService } from '../notification.service';
import { CreateNotificationDto } from './create-notification.dto';

@Injectable()
export class CreateNotificationService {
  constructor(private readonly notifications: NotificationService) {}

  async execute(dto: CreateNotificationDto): Promise<NotificationDto> {
    const config = CreateNotificationService.configFrom(dto);
    const entity = this.notifications.repo.create({
      name: dto.name.trim(),
      type: dto.type,
      configEncrypted: this.notifications.encryptConfig(config),
      onDeploymentSuccess: dto.onDeploymentSuccess ?? true,
      onDeploymentFailure: dto.onDeploymentFailure ?? true,
      onBackupFailure: dto.onBackupFailure ?? true,
      onJobFailure: dto.onJobFailure ?? true,
      onDiskLow: dto.onDiskLow ?? true,
      onCertificateFailure: dto.onCertificateFailure ?? true,
      onContainerDown: dto.onContainerDown ?? true,
    });
    const saved = await this.notifications.repo.save(entity);
    return this.notifications.toDto(saved, config);
  }

  /** The DTO is validated per type, so the fields below are present. */
  static configFrom(dto: CreateNotificationDto): NotificationConfig {
    switch (dto.type) {
      case 'telegram':
        return {
          type: 'telegram',
          botToken: dto.botToken!.trim(),
          chatId: dto.chatId!.trim(),
        };
      case 'slack':
        return { type: 'slack', webhookUrl: dto.webhookUrl!.trim() };
      case 'discord':
        return { type: 'discord', webhookUrl: dto.webhookUrl!.trim() };
      case 'webhook':
        return {
          type: 'webhook',
          url: dto.url!.trim(),
          secret: dto.secret?.trim() || null,
        };
      case 'email':
        return {
          type: 'email',
          host: dto.smtpHost!.trim(),
          port: dto.smtpPort!,
          secure: dto.smtpSecure ?? false,
          username: dto.smtpUsername?.trim() || null,
          password: dto.smtpPassword || null,
          from: dto.from!.trim(),
          to: dto.to!.map((t) => t.trim()),
        };
    }
  }
}
