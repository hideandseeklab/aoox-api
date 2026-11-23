import { plainToInstance } from 'class-transformer';
import { NormalizeNewlines, normalizeNewlines } from './normalize-newlines';

class Sample {
  @NormalizeNewlines()
  env?: unknown;
}

describe('normalizeNewlines', () => {
  it('turns CRLF and lone CR into LF', () => {
    expect(normalizeNewlines('A=1\r\nB=2\rC=3\n')).toBe('A=1\nB=2\nC=3\n');
  });

  it('leaves LF text unchanged', () => {
    expect(normalizeNewlines('A=1\nB=2')).toBe('A=1\nB=2');
  });

  it('is applied by the DTO decorator to strings only', () => {
    expect(plainToInstance(Sample, { env: 'A=1\r\nB=2' }).env).toBe('A=1\nB=2');
    expect(plainToInstance(Sample, { env: null }).env).toBeNull();
  });
});
