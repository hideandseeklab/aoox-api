import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { NotificationType } from '../notification.entity';

const HTTPS_URL = { protocols: ['https'], require_protocol: true };

export class CreateNotificationDto {
  @IsString()
  @Length(1, 100)
  name: string;

  @IsIn(['telegram', 'slack', 'discord', 'webhook', 'email'])
  type: NotificationType;

  /** Telegram: bot token from @BotFather. */
  @ValidateIf((o: CreateNotificationDto) => o.type === 'telegram')
  @IsString()
  @Matches(/^\d+:[A-Za-z0-9_-]{30,}$/, { message: 'botToken is not valid' })
  botToken?: string;

  /** Telegram: chat/group/channel id (may be negative). */
  @ValidateIf((o: CreateNotificationDto) => o.type === 'telegram')
  @IsString()
  @Matches(/^-?\d+$/, { message: 'chatId must be numeric' })
  chatId?: string;

  /** Slack / Discord incoming webhook. */
  @ValidateIf(
    (o: CreateNotificationDto) => o.type === 'slack' || o.type === 'discord',
  )
  @IsUrl(HTTPS_URL, { message: 'webhookUrl must be an https URL' })
  webhookUrl?: string;

  /** Generic webhook: receives a JSON POST. */
  @ValidateIf((o: CreateNotificationDto) => o.type === 'webhook')
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false,
  })
  url?: string;

  /** Generic webhook: HMAC-SHA256 key for `X-Aoox-Signature` (optional). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  secret?: string;

  // Email (SMTP settings are per channel, like every other channel's secrets)
  @ValidateIf((o: CreateNotificationDto) => o.type === 'email')
  @IsString()
  @Length(1, 255)
  smtpHost?: string;

  @ValidateIf((o: CreateNotificationDto) => o.type === 'email')
  @IsInt()
  @Min(1)
  @Max(65535)
  smtpPort?: number;

  /** Implicit TLS (465); otherwise STARTTLS is negotiated when offered. */
  @ValidateIf((o: CreateNotificationDto) => o.type === 'email')
  @IsBoolean()
  smtpSecure?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  smtpUsername?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  smtpPassword?: string;

  @ValidateIf((o: CreateNotificationDto) => o.type === 'email')
  @IsEmail()
  from?: string;

  @ValidateIf((o: CreateNotificationDto) => o.type === 'email')
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsEmail({}, { each: true })
  to?: string[];

  @IsOptional()
  @IsBoolean()
  onDeploymentSuccess?: boolean;

  @IsOptional()
  @IsBoolean()
  onDeploymentFailure?: boolean;

  @IsOptional()
  @IsBoolean()
  onBackupFailure?: boolean;

  @IsOptional()
  @IsBoolean()
  onJobFailure?: boolean;

  @IsOptional()
  @IsBoolean()
  onDiskLow?: boolean;

  @IsOptional()
  @IsBoolean()
  onCertificateFailure?: boolean;

  @IsOptional()
  @IsBoolean()
  onContainerDown?: boolean;
}
