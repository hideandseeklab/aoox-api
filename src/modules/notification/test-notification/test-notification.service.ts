import { Injectable } from '@nestjs/common';
import { sendNotification } from '../notification-sender';
import { NotificationService } from '../notification.service';
import { TestNotificationResponseDto } from './test-notification.dto';

/** Posts a sample message so the user can confirm the channel works. */
@Injectable()
export class TestNotificationService {
  constructor(private readonly notifications: NotificationService) {}

  async execute(id: string): Promise<TestNotificationResponseDto> {
    const { notification, config } = await this.notifications.resolve(id);
    try {
      await sendNotification(config, {
        title: `Test notification: ${notification.name}`,
        level: 'info',
        fields: [['Source', 'aoox']],
        data: { event: 'test', notification: notification.name },
      });
      return { ok: true, message: 'Test message sent' };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
