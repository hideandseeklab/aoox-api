import { IsString, Length } from 'class-validator';
import { JobFieldsDto } from '../job.dto';

export class CreateJobDto extends JobFieldsDto {
  @IsString()
  @Length(1, 100)
  declare name: string;

  @IsString()
  @Length(1, 4000)
  declare command: string;
}
