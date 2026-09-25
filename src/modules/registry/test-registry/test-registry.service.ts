import { Injectable } from '@nestjs/common';
import { RegistryClientError } from '../registry-client';
import { RegistryService } from '../registry.service';
import { TestRegistryResponseDto } from './test-registry.dto';

/** `GET /v2/` with the stored credentials. */
@Injectable()
export class TestRegistryService {
  constructor(private readonly registries: RegistryService) {}

  async execute(id: string): Promise<TestRegistryResponseDto> {
    const client = await this.registries.clientFor(id);
    try {
      await client.check();
      return {
        ok: true,
        message: 'Registry reachable and credentials accepted',
      };
    } catch (err) {
      if (err instanceof RegistryClientError) {
        const message =
          err.status === 401
            ? 'Registry rejected the credentials'
            : `Registry responded with HTTP ${err.status}`;
        return { ok: false, message };
      }
      return { ok: false, message: `Cannot reach registry: ${String(err)}` };
    }
  }
}
