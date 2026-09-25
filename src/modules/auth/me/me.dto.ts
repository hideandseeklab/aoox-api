export class MeResponseDto {
  id: string;
  email: string;
  name: string | null;
  role: string;
  twoFactorEnabled: boolean;
}
