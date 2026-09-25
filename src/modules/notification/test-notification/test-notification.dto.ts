import { IsUUID } from 'class-validator';

export class TestNotificationParamsDto {
  @IsUUID()
  id: string;
}

export class TestNotificationResponseDto {
  ok: boolean;
  message: string;
}
