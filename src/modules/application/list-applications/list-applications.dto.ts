import { IsUUID } from 'class-validator';
import { Application } from '../application.entity';

export class ListApplicationsQueryDto {
  @IsUUID()
  projectId: string;
}

/** A hostname routed to an application, as shown on its project card. */
export class ApplicationListDomainDto {
  host: string;
  https: boolean;
}

/** An application plus its domains (for the "where do I open it" link). */
export type ApplicationListItemDto = Application & {
  domains: ApplicationListDomainDto[];
};
