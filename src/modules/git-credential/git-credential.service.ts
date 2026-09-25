import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { decryptSecret, encryptSecret } from '../docker/secret.util';
import { GitCredential } from './git-credential.entity';

export interface GitCredentialDto {
  id: string;
  name: string;
  provider: GitCredential['provider'];
  username: string;
  createdAt: Date;
}

@Injectable()
export class GitCredentialService {
  private readonly key: string;

  constructor(
    @InjectRepository(GitCredential)
    readonly repo: Repository<GitCredential>,
    config: ConfigService,
  ) {
    this.key = config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  toDto(c: GitCredential): GitCredentialDto {
    return {
      id: c.id,
      name: c.name,
      provider: c.provider,
      username: c.username,
      createdAt: c.createdAt,
    };
  }

  encrypt(token: string): string {
    return encryptSecret(token, this.key);
  }

  async findOrFail(id: string): Promise<GitCredential> {
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Git credential not found');
    return c;
  }

  /** Username + decrypted token, for building the authenticated clone URL. */
  async resolve(id: string): Promise<{ username: string; token: string }> {
    const c = await this.repo
      .createQueryBuilder('c')
      .addSelect('c.tokenEncrypted')
      .where('c.id = :id', { id })
      .getOne();
    if (!c) throw new NotFoundException('Git credential not found');
    return {
      username: c.username,
      token: decryptSecret(c.tokenEncrypted, this.key),
    };
  }

  /** `https://host/repo` + credentials -> `https://user:token@host/repo`. */
  static authenticateUrl(
    gitUrl: string,
    username: string,
    token: string,
  ): string {
    const u = new URL(gitUrl);
    u.username = encodeURIComponent(username);
    u.password = encodeURIComponent(token);
    return u.toString();
  }
}
