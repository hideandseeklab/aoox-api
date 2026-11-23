import { ProjectResourceUsageService } from '../project-resource-usage/project-resource-usage.service';
import { ProjectService } from '../project.service';
import { ListProjectsService } from './list-projects.service';

describe('ListProjectsService', () => {
  const project = { id: 'p1', name: 'shop' };
  const find = jest.fn();
  const query = jest.fn();
  const usageByProject = jest.fn();

  const service = () =>
    new ListProjectsService(
      {
        repo: { find, query },
        access: { whereAccessible: jest.fn().mockResolvedValue({}) },
      } as unknown as ProjectService,
      { usageByProject } as unknown as ProjectResourceUsageService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    find.mockResolvedValue([project]);
    query.mockResolvedValue([]);
  });

  it('still lists the projects when the Docker daemon cannot be reached', async () => {
    usageByProject.mockRejectedValue(
      Object.assign(new Error('connect ENOENT /var/run/docker.sock'), {
        code: 'ENOENT',
        syscall: 'connect',
        address: '/var/run/docker.sock',
      }),
    );
    const list = await service().execute('u1', {});
    expect(list).toEqual([{ ...project, instances: [], resourceUsage: null }]);
  });

  it('does not hide other failures', async () => {
    usageByProject.mockRejectedValue(new Error('boom'));
    await expect(service().execute('u1', {})).rejects.toThrow('boom');
  });
});
