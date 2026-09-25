import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectAccessService } from '../project/project-access.service';
import { JobRun } from './job-run.entity';
import { JobSchedulerService } from './job-scheduler.service';
import { CreateJobDto } from './create-job/create-job.dto';
import { Job } from './job.entity';

@Injectable()
export class JobService {
  constructor(
    @InjectRepository(Job) readonly repo: Repository<Job>,
    @InjectRepository(JobRun) readonly runs: Repository<JobRun>,
    private readonly access: ProjectAccessService,
  ) {}

  /** Access follows the owning application/database/compose stack's project. */
  async findOwnedOrFail(id: string, ownerId: string): Promise<Job> {
    const job = await this.repo.findOne({
      where: { id },
      relations: {
        application: { project: true },
        database: { project: true },
        composeApp: { project: true },
      },
    });
    if (!job) throw new NotFoundException('Job not found');
    const project =
      job.application?.project ??
      job.database?.project ??
      job.composeApp?.project;
    if (!project) throw new NotFoundException('Job not found');
    await this.access.assertAccess(ownerId, project);
    return job;
  }

  /** Validates and builds the row for any owner; the caller sets the owner column. */
  build(
    owner: Partial<Pick<Job, 'applicationId' | 'databaseId' | 'composeAppId'>>,
    dto: CreateJobDto,
    service: string | null = null,
  ): Job {
    const cron = dto.cron?.trim() || null;
    if (cron && !JobSchedulerService.isValidCron(cron)) {
      throw new BadRequestException('cron is not a valid expression');
    }
    return this.repo.create({
      applicationId: null,
      databaseId: null,
      composeAppId: null,
      ...owner,
      service,
      name: dto.name.trim(),
      cron,
      command: dto.command,
      target: dto.target ?? 'container',
      enabled: dto.enabled ?? true,
      timeoutSeconds: dto.timeoutSeconds ?? 600,
    });
  }
}
