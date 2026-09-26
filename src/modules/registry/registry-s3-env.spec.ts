import type { DestinationConfig } from '../backup-destination/backup-destination.service';
import { registryS3Env } from './registry-s3-env';

const base: DestinationConfig = {
  endpoint: null,
  region: 'us-east-1',
  bucket: 'my-bucket',
  prefix: '',
  accessKeyId: 'AKIA...',
  secretAccessKey: 'secret',
  forcePathStyle: true,
};

describe('registryS3Env', () => {
  it('sets the storage driver and core S3 vars', () => {
    const env = registryS3Env(base);
    expect(env).toContain('REGISTRY_STORAGE=s3');
    expect(env).toContain('REGISTRY_STORAGE_S3_ACCESSKEY=AKIA...');
    expect(env).toContain('REGISTRY_STORAGE_S3_SECRETKEY=secret');
    expect(env).toContain('REGISTRY_STORAGE_S3_BUCKET=my-bucket');
    expect(env).toContain('REGISTRY_STORAGE_S3_REGION=us-east-1');
  });

  it('defaults an empty region to us-east-1', () => {
    const env = registryS3Env({ ...base, region: '' });
    expect(env).toContain('REGISTRY_STORAGE_S3_REGION=us-east-1');
  });

  it('is secure by default and insecure only for an explicit http endpoint', () => {
    expect(registryS3Env(base)).toContain('REGISTRY_STORAGE_S3_SECURE=true');
    expect(
      registryS3Env({ ...base, endpoint: 'https://minio.example.com' }),
    ).toContain('REGISTRY_STORAGE_S3_SECURE=true');
    expect(
      registryS3Env({ ...base, endpoint: 'http://minio.internal:9000' }),
    ).toContain('REGISTRY_STORAGE_S3_SECURE=false');
  });

  it('adds REGIONENDPOINT only when an endpoint is set (MinIO/R2/etc.)', () => {
    expect(
      registryS3Env(base).some((l) =>
        l.startsWith('REGISTRY_STORAGE_S3_REGIONENDPOINT='),
      ),
    ).toBe(false);
    expect(
      registryS3Env({ ...base, endpoint: 'https://minio.example.com' }),
    ).toContain('REGISTRY_STORAGE_S3_REGIONENDPOINT=https://minio.example.com');
  });

  it('normalizes the prefix into ROOTDIRECTORY, or omits it when empty', () => {
    expect(
      registryS3Env(base).some((l) =>
        l.startsWith('REGISTRY_STORAGE_S3_ROOTDIRECTORY='),
      ),
    ).toBe(false);
    expect(registryS3Env({ ...base, prefix: 'aoox/registry' })).toContain(
      'REGISTRY_STORAGE_S3_ROOTDIRECTORY=/aoox/registry',
    );
    expect(registryS3Env({ ...base, prefix: '/aoox/registry/' })).toContain(
      'REGISTRY_STORAGE_S3_ROOTDIRECTORY=/aoox/registry',
    );
  });

  it('carries forcePathStyle through as a string', () => {
    expect(registryS3Env({ ...base, forcePathStyle: false })).toContain(
      'REGISTRY_STORAGE_S3_FORCEPATHSTYLE=false',
    );
  });
});
