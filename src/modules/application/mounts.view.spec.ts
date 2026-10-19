import { Mount } from './mount.entity';
import { mountView } from './mounts';

const file = Object.assign(new Mount(), {
  id: 'm1',
  type: 'file' as const,
  name: 'app.conf',
  containerPath: '/etc/app.conf',
  content: 'password=hunter2',
});
const volume = Object.assign(new Mount(), {
  id: 'm2',
  type: 'volume' as const,
  name: 'data',
  containerPath: '/data',
  content: null,
});

describe('mountView', () => {
  it('keeps the body of a file mount for developers and above', () => {
    expect(mountView(file, true)).toMatchObject({
      content: 'password=hunter2',
      contentHidden: false,
    });
  });

  it('leaves the body out for viewers but keeps name and path', () => {
    const v = mountView(file, false);
    expect(v.content).toBeNull();
    expect(v.contentHidden).toBe(true);
    expect(v.name).toBe('app.conf');
    expect(v.containerPath).toBe('/etc/app.conf');
    expect(JSON.stringify(v)).not.toContain('hunter2');
    // the source row is not modified
    expect(file.content).toBe('password=hunter2');
  });

  it('does not flag mounts that have no body', () => {
    expect(mountView(volume, false).contentHidden).toBe(false);
  });
});
