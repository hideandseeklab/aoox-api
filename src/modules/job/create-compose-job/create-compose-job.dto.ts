import { IsString, Matches } from 'class-validator';
import { CreateJobDto } from '../create-job/create-job.dto';

export class CreateComposeJobDto extends CreateJobDto {
  /** Compose service name the job runs in / whose image it uses. */
  @IsString()
  @Matches(/^[a-zA-Z0-9_.-]+$/)
  service: string;
}
