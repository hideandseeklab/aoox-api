import { IsUUID } from 'class-validator';

export class TestRegistryParamsDto {
  @IsUUID()
  id: string;
}

export class TestRegistryResponseDto {
  ok: boolean;
  message: string;
}
