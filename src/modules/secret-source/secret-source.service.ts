import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { decryptSecret, encryptSecret } from '../docker/secret.util';
import {
  fetchSecrets,
  InfisicalSelection,
  login,
  SecretSourceError,
} from './infisical.client';
import { SecretConnection } from './secret-connection.entity';

/** What the API and the web may see: never the client secret. */
export interface SecretConnectionDto {
  id: string;
  name: string;
  provider: SecretConnection['provider'];
  url: string | null;
  clientId: string;
  createdAt: Date;
}

@Injectable()
export class SecretSourceService {
  private readonly key: string;

  constructor(
    @InjectRepository(SecretConnection)
    readonly repo: Repository<SecretConnection>,
    config: ConfigService,
  ) {
    this.key = config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  toDto(c: SecretConnection): SecretConnectionDto {
    return {
      id: c.id,
      name: c.name,
      provider: c.provider,
      url: c.url,
      clientId: c.clientId,
      createdAt: c.createdAt,
    };
  }

  encrypt(secret: string): string {
    return encryptSecret(secret, this.key);
  }

  async findOrFail(id: string): Promise<SecretConnection> {
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Secret connection not found');
    return c;
  }

  private async withSecret(
    id: string,
  ): Promise<{ conn: SecretConnection; clientSecret: string }> {
    const conn = await this.repo
      .createQueryBuilder('c')
      .addSelect('c.clientSecretEncrypted')
      .where('c.id = :id', { id })
      .getOne();
    if (!conn) throw new NotFoundException('Secret connection not found');
    return {
      conn,
      clientSecret: decryptSecret(conn.clientSecretEncrypted, this.key),
    };
  }

  /**
   * Fetches the secrets of one folder (login + list in one call, the access
   * token is dropped right after). Nothing is cached across calls. Failures
   * surface as `SecretSourceError` with the connection name and a short,
   * credential-free reason.
   */
  async fetch(
    connectionId: string,
    selection: InfisicalSelection,
  ): Promise<Map<string, string>> {
    const { conn, clientSecret } = await this.withSecret(connectionId);
    try {
      return await fetchSecrets(
        { url: conn.url, clientId: conn.clientId, clientSecret },
        selection,
      );
    } catch (err) {
      if (err instanceof SecretSourceError) {
        throw new SecretSourceError(
          `Secret source "${conn.name}": ${err.message}`,
        );
      }
      throw err;
    }
  }

  /** Universal Auth login only: proves the URL and the identity work. */
  async test(id: string): Promise<{ ok: boolean; message: string }> {
    const { conn, clientSecret } = await this.withSecret(id);
    try {
      await login({ url: conn.url, clientId: conn.clientId, clientSecret });
      return { ok: true, message: 'Login succeeded' };
    } catch (err) {
      return {
        ok: false,
        message:
          err instanceof SecretSourceError ? err.message : 'Login failed',
      };
    }
  }
}
