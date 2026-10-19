import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExportProjectService } from './export-project.service';

function build(role: 'viewer' | 'developer' | 'outsider') {
  const project = { id: 'p1' };
  const exporter = { export: jest.fn().mockResolvedValue({ format: 'x' }) };
  const projects = {
    findOwnedOrFail: jest.fn().mockResolvedValue(project),
    access: {
      assertCanExport: jest.fn(() =>
        role === 'viewer'
          ? Promise.reject(new ForbiddenException())
          : role === 'outsider'
            ? Promise.reject(new NotFoundException())
            : Promise.resolve('developer'),
      ),
    },
  };
  return {
    svc: new ExportProjectService(projects as never, exporter as never),
    exporter,
  };
}

describe('ExportProjectService', () => {
  const dev = { sub: 'u', role: 'member' } as never;

  it('refuses viewers before reading anything', async () => {
    const { svc, exporter } = build('viewer');
    await expect(svc.execute(dev, 'p1', false)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(exporter.export).not.toHaveBeenCalled();
  });

  it('developers export; secrets stay owner-only', async () => {
    const { svc, exporter } = build('developer');
    await expect(svc.execute(dev, 'p1', false)).resolves.toBeDefined();
    expect(exporter.export).toHaveBeenCalled();
    await expect(svc.execute(dev, 'p1', true)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
