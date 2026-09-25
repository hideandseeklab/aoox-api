import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class AddDomainDto {
  @IsString()
  @MaxLength(253)
  @Matches(/^(?=.{1,253}$)(?!-)[a-z0-9-]+(?<!-)(\.(?!-)[a-z0-9-]+(?<!-))*$/i, {
    message: 'host must be a valid hostname like app.example.com',
  })
  host: string;

  @IsOptional()
  @IsBoolean()
  https?: boolean;
}
