import { Injectable } from '@nestjs/common';
import { UserService } from '../../user/user.service';
import { SetupStatusResponseDto } from './setup-status.dto';

@Injectable()
export class SetupStatusService {
  constructor(private readonly userService: UserService) {}

  async execute(): Promise<SetupStatusResponseDto> {
    return { needsSetup: (await this.userService.count()) === 0 };
  }
}
