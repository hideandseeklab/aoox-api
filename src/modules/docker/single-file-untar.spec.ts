import { SingleFileUntar } from './docker-engine.client';

/** Builds a minimal ustar stream: header + content padded to 512 + two zero blocks. */
function tarOf(content: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write('file.bin', 0, 'ascii');
  header.write(
    content.length.toString(8).padStart(11, '0') + '\0',
    124,
    'ascii',
  );
  const padded = Buffer.alloc(Math.ceil(content.length / 512) * 512);
  content.copy(padded);
  return Buffer.concat([header, padded, Buffer.alloc(1024)]);
}

describe('SingleFileUntar', () => {
  const content = Buffer.from('hello backup\n'.repeat(50));

  it('strips the header, padding and trailer when fed in one chunk', () => {
    const u = new SingleFileUntar();
    expect(u.push(tarOf(content)).equals(content)).toBe(true);
  });

  it('handles chunks that split the header and the body', () => {
    const tar = tarOf(content);
    const u = new SingleFileUntar();
    const parts: Buffer[] = [];
    for (let i = 0; i < tar.length; i += 100)
      parts.push(u.push(tar.subarray(i, i + 100)));
    expect(Buffer.concat(parts).equals(content)).toBe(true);
  });

  it('yields nothing for an empty file', () => {
    const u = new SingleFileUntar();
    expect(u.push(tarOf(Buffer.alloc(0))).length).toBe(0);
  });
});
