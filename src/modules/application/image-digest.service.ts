import { Injectable } from '@nestjs/common';
import { RegistryService } from '../registry/registry.service';
import { fetchRemoteDigest } from '../registry/remote-digest';
import { Application } from './application.entity';
import { parseImageRef } from './image-reference';

/**
 * Digest of an application's image tag as the registry currently serves it.
 * Used by the runner right after a pull (baseline) and by the update watcher
 * (comparison), so both sides always speak the registry's digest — comparing
 * against Docker's local `RepoDigests` would risk a redeploy loop when the two
 * representations differ.
 */
@Injectable()
export class ImageDigestService {
  constructor(private readonly registries: RegistryService) {}

  /** null = reference pins a digest already (nothing can change). */
  async remoteDigest(app: Application): Promise<string | null> {
    if (!app.imageRef) throw new Error('Application has no image reference');
    const ref = parseImageRef(app.imageRef);
    if (ref.digest) return null;
    let baseUrl = /^(localhost|127\.0\.0\.1)(:|$)/.test(ref.registry)
      ? `http://${ref.registry}`
      : `https://${ref.registry}`;
    let creds: { username?: string | null; password?: string | null } = {};
    if (app.imageRegistryId) {
      const { registry, password } = await this.registries.findWithPassword(
        app.imageRegistryId,
      );
      creds = { username: registry.username, password };
      // Credentials belong to this registry; its own base URL knows the scheme
      // (and the internal address of the self-hosted one).
      const host = registry.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
      if (host === ref.registry || registry.type === 'self-hosted') {
        baseUrl = this.registries.apiBaseUrl(registry);
      }
    }
    return fetchRemoteDigest(baseUrl, ref.repository, ref.tag, creds);
  }
}
