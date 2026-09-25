import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { decryptSecret, encryptSecret } from '../docker/secret.util';
import { SshKeyService } from '../ssh/ssh-key.service';
import { SshTarget } from '../ssh/ssh.session';
import { Server } from './server.entity';

/** Public shape (never includes the private key). */
export interface ServerDto {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  /** False = authenticates with the platform key shown in Settings. */
  hasOwnKey: boolean;
  /** Traefik settings on this server (Servers → Proxy). */
  proxyHttpPort: number;
  proxyHttpsPort: number;
  acmeEmail: string | null;
  acmeStaging: boolean;
  createdAt: Date;
}

export interface ResolvedServer {
  server: Server;
  target: SshTarget;
  /** True when `target.privateKey` is the platform key (authorizable from the UI). */
  usesPlatformKey: boolean;
}

@Injectable()
export class ServerService {
  private readonly encryptionKey: string;

  constructor(
    @InjectRepository(Server)
    readonly repo: Repository<Server>,
    private readonly keys: SshKeyService,
    config: ConfigService,
  ) {
    this.encryptionKey = config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  toDto(s: Server, hasOwnKey: boolean): ServerDto {
    return {
      id: s.id,
      name: s.name,
      host: s.host,
      port: s.port,
      username: s.username,
      hasOwnKey,
      proxyHttpPort: s.proxyHttpPort,
      proxyHttpsPort: s.proxyHttpsPort,
      acmeEmail: s.acmeEmail,
      acmeStaging: s.acmeStaging,
      createdAt: s.createdAt,
    };
  }

  encryptPrivateKey(plain: string): string {
    return encryptSecret(plain, this.encryptionKey);
  }

  async findOrFail(id: string): Promise<Server> {
    const s = await this.repo.findOne({ where: { id } });
    if (!s) throw new NotFoundException('Server not found');
    return s;
  }

  /** All servers with a `hasOwnKey` flag, without loading the keys themselves. */
  async listWithKeyFlag(): Promise<
    Array<{ server: Server; hasOwnKey: boolean }>
  > {
    const { entities, raw } = await this.repo
      .createQueryBuilder('s')
      .addSelect('s.private_key_encrypted IS NOT NULL', 'has_own_key')
      .orderBy('s.created_at', 'ASC')
      .getRawAndEntities<{ has_own_key: boolean }>();
    return entities.map((server, i) => ({
      server,
      hasOwnKey: Boolean(raw[i]?.has_own_key),
    }));
  }

  /** Connection details for `SshSession.open`, falling back to the platform key. */
  async resolve(id: string): Promise<ResolvedServer> {
    const server = await this.repo
      .createQueryBuilder('s')
      .addSelect('s.privateKeyEncrypted')
      .where('s.id = :id', { id })
      .getOne();
    if (!server) throw new NotFoundException('Server not found');
    const usesPlatformKey = !server.privateKeyEncrypted;
    const privateKey = server.privateKeyEncrypted
      ? decryptSecret(server.privateKeyEncrypted, this.encryptionKey)
      : this.keys.load().privateKey;
    return {
      server,
      usesPlatformKey,
      target: {
        host: server.host,
        port: server.port,
        username: server.username,
        privateKey,
      },
    };
  }
}
