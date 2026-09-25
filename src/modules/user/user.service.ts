import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
