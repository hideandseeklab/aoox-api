import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { Invitation } from '../invitation/invitation.entity';
import { Project } from '../project/project.entity';
import { User, UserRole } from './user.entity';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  name?: string | null;
  role?: UserRole;
}

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    readonly repo: Repository<User>,
  ) {}

  count(): Promise<number> {
    return this.repo.count();
  }

  findById(id: string): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  /** Includes `passwordHash` and the 2FA columns; only use for credential checks. */
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.repo
      .createQueryBuilder('user')
      .addSelect([
        'user.passwordHash',
        'user.totpSecretEncrypted',
        'user.totpBackupHashes',
      ])
      .where('user.email = :email', { email: email.toLowerCase() })
      .getOne();
  }

  /** Same, by id (second sign-in step and 2FA management). */
  findByIdWithSecrets(id: string): Promise<User | null> {
    return this.repo
      .createQueryBuilder('user')
      .addSelect([
        'user.passwordHash',
        'user.totpSecretEncrypted',
        'user.totpBackupHashes',
      ])
      .where('user.id = :id', { id })
      .getOne();
  }

  static normalizeEmail(email: string): string {
    return email.toLowerCase().trim();
  }

  /** Trimmed; empty or null clears the name. */
  static cleanName(name: string | null): string | null {
    return name?.trim() || null;
  }

  /**
   * An email may belong to one account and must not be reserved by a pending
   * (not accepted, not expired) invitation. `email` must already be normalised.
   */
  async assertEmailAvailable(
    email: string,
    exceptUserId?: string,
  ): Promise<void> {
    const existing = await this.repo.findOne({ where: { email } });
    if (existing && existing.id !== exceptUserId) {
      throw new ConflictException('A user with this email already exists');
    }
    const pending = await this.repo.manager.findOne(Invitation, {
      where: { email, acceptedAt: IsNull(), expiresAt: MoreThan(new Date()) },
    });
    if (pending) {
      throw new ConflictException(
        'A pending invitation already uses this email; revoke it first',
      );
    }
  }

  /** Writes name/email; a unique-index race surfaces as the same 409. */
  async updateProfile(
    id: string,
    patch: { name?: string | null; email?: string },
  ): Promise<void> {
    try {
      await this.repo.update(id, patch);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException('A user with this email already exists');
      }
      throw e;
    }
  }

  create(input: CreateUserInput): Promise<User> {
    const user = this.repo.create({
      email: input.email.toLowerCase().trim(),
      passwordHash: input.passwordHash,
      name: input.name?.trim() || null,
      role: input.role ?? 'member',
    });
    return this.repo.save(user);
  }

  /** Demoting/removing the only owner would lock everyone out of owner-only flows. */
  async assertNotLastOwner(userId: string): Promise<void> {
    const others = await this.repo.count({ where: { role: 'owner' } });
    // `others` includes this user; they must not be the only one.
    if (others <= 1) {
      throw new ConflictException(
        'This is the last owner; promote someone else first',
      );
    }
    void userId;
  }

  /** projects.owner_id cascades; refuse rather than silently deleting deployments. */
  async assertOwnsNoProjects(userId: string): Promise<void> {
    const n = await this.repo.manager.count(Project, {
      where: { ownerId: userId },
    });
    if (n > 0) {
      throw new ConflictException(
        `User still owns ${n} project(s); delete or hand them over first`,
      );
    }
  }
}
