import type { Repository } from 'typeorm';
import type { ProjectService } from '../../project/project.service';
import type { Application } from '../application.entity';
import type { ApplicationService } from '../application.service';
import type { Domain } from '../domain.entity';
import { ListApplicationsService } from './list-applications.service';

function setup(apps: Partial<Application>[], domains: Partial<Domain>[]) {
  const appFind = jest.fn().mockResolvedValue(apps);
  const domainFind = jest.fn().mockResolvedValue(domains);
  const findOwnedOrFail = jest.fn().mockResolvedValue({});
  const service = new ListApplicationsService(
    { repo: { find: appFind } } as unknown as ApplicationService,
    { findOwnedOrFail } as unknown as ProjectService,
    { find: domainFind } as unknown as Repository<Domain>,
  );
  return { service, appFind, domainFind, findOwnedOrFail };
}

describe('ListApplicationsService', () => {
  it('attaches each app its domains with a single domain query', async () => {
    const { service, domainFind, findOwnedOrFail } = setup(
      [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }],
      [
        { applicationId: 'a1', host: 'one.example.com', https: true },
        { applicationId: 'a1', host: 'two.example.com', https: false },
        { applicationId: 'a3', host: 'three.example.com', https: true },
      ],
    );
    const result = await service.execute('user', 'project');
    expect(findOwnedOrFail).toHaveBeenCalledWith('project', 'user');
    expect(domainFind).toHaveBeenCalledTimes(1);
    expect(result.map((a) => a.domains)).toEqual([
      [
        { host: 'one.example.com', https: true },
        { host: 'two.example.com', https: false },
      ],
      [],
      [{ host: 'three.example.com', https: true }],
    ]);
  });

  it('skips the domain query when the project has no applications', async () => {
    const { service, domainFind } = setup([], []);
    expect(await service.execute('user', 'project')).toEqual([]);
    expect(domainFind).not.toHaveBeenCalled();
  });
});
