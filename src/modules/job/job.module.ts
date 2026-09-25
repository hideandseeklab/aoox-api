import { Module } from '@nestjs/common';
import { ProjectModule } from '../project/project.module';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApplicationModule } from '../application/application.module';
import { ComposeModule } from '../compose/compose.module';
import { ManagedDatabaseModule } from '../managed-database/managed-database.module';
import { DockerModule } from '../docker/docker.module';
import { NotificationModule } from '../notification/notification.module';
import { ServerModule } from '../server/server.module';
import { CreateComposeJobController } from './create-compose-job/create-compose-job.controller';
import { CreateDatabaseJobController } from './create-database-job/create-database-job.controller';
import { CreateJobController } from './create-job/create-job.controller';
import { ListComposeJobsController } from './list-compose-jobs/list-compose-jobs.controller';
import { ListDatabaseJobsController } from './list-database-jobs/list-database-jobs.controller';
import { DeleteJobController } from './delete-job/delete-job.controller';
import { JobRun } from './job-run.entity';
import { JobRunnerService } from './job-runner.service';
import { JobSchedulerService } from './job-scheduler.service';
import { Job } from './job.entity';
import { JobService } from './job.service';
import { ListJobRunsController } from './list-job-runs/list-job-runs.controller';
import { ListJobsController } from './list-jobs/list-jobs.controller';
import { RunJobController } from './run-job/run-job.controller';
import { UpdateJobController } from './update-job/update-job.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Job, JobRun]),
    ScheduleModule.forRoot(),
    ApplicationModule,
    ManagedDatabaseModule,
    ComposeModule,
    DockerModule,
    ServerModule,
    NotificationModule,
    ProjectModule,
  ],
  controllers: [
    CreateJobController,
    ListJobsController,
    CreateDatabaseJobController,
    ListDatabaseJobsController,
    CreateComposeJobController,
    ListComposeJobsController,
    UpdateJobController,
    DeleteJobController,
    RunJobController,
    ListJobRunsController,
  ],
  providers: [JobService, JobRunnerService, JobSchedulerService],
  exports: [JobService, JobSchedulerService],
})
export class JobModule {}
