import { normalizePath } from './add-mount/add-mount.service';
import { Application } from './application.entity';
import { Mount } from './mount.entity';
import { bindsFor, filesVolumeFor, volumeNameFor } from './mounts';

const app = { appName: 'my-app-x1' } as Application;
const m = (over: Partial<Mount>): Mount =>
  ({
    readOnly: false,
    name: null,
    hostPath: null,
    content: null,
    ...over,
  }) as Mount;

describe('mounts', () => {
  it('names volumes after the app and mount (underscores, like other volumes)', () => {
    expect(volumeNameFor(app, m({ name: 'up-loads' }))).toBe(
      'aoox_app_my_app_x1_up_loads',
    );
    expect(filesVolumeFor(app)).toBe('aoox_app_my_app_x1_files');
  });

  it('renders Binds for volume, bind and file mounts', () => {
    const binds = bindsFor(
      app,
      [
        m({ type: 'volume', name: 'data', containerPath: '/var/lib/data' }),
        m({
          type: 'bind',
          hostPath: '/srv/x',
          containerPath: '/x',
          readOnly: true,
        }),
        m({
          type: 'file',
          name: 'nginx.conf',
          containerPath: '/etc/nginx/nginx.conf',
        }),
      ],
      '/var/lib/docker/volumes/aoox_app_my_app_x1_files/_data',
    );
    expect(binds).toEqual([
      'aoox_app_my_app_x1_data:/var/lib/data',
      '/srv/x:/x:ro',
      '/var/lib/docker/volumes/aoox_app_my_app_x1_files/_data/nginx.conf:/etc/nginx/nginx.conf:ro',
    ]);
  });

  it('skips file mounts when the files volume was not prepared', () => {
    expect(
      bindsFor(
        app,
        [m({ type: 'file', name: 'a', containerPath: '/a' })],
        null,
      ),
    ).toEqual([]);
  });

  it('normalizes paths', () => {
    expect(normalizePath('/data//x/')).toBe('/data/x');
    expect(normalizePath(' / ')).toBe('/');
  });
});
