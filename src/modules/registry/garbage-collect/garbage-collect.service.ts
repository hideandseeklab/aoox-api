import { Injectable } from '@nestjs/common';
import { SelfHostedRegistryService } from '../self-hosted-registry.service';
import { GarbageCollectResponseDto } from './garbage-collect.dto';

@Injectable()
export class GarbageCollectService {
  constructor(private readonly selfHosted: SelfHostedRegistryService) {}

  async execute(dryRun: boolean): Promise<GarbageCollectResponseDto> {
    const output = await this.selfHosted.garbageCollect(dryRun);
    return { dryRun, output };
  }
}
