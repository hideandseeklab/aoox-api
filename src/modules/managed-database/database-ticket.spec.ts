import { ConflictException } from '@nestjs/common';
import { pickDatabaseContainer } from './database-ticket';

const box = (State: string) => ({ Id: 'c1', Names: ['/x'], State }) as never;

describe('pickDatabaseContainer', () => {
  it('returns a running container for both needs', () => {
    expect(pickDatabaseContainer(box('running'), 'running', 'x')).toBeTruthy();
    expect(pickDatabaseContainer(box('running'), 'exists', 'x')).toBeTruthy();
  });
  it('console needs it running, logs accept a stopped one', () => {
    expect(() => pickDatabaseContainer(box('exited'), 'running', 'x')).toThrow(
      /not running/,
    );
    expect(pickDatabaseContainer(box('exited'), 'exists', 'x')).toBeTruthy();
  });
  it('409 when the container does not exist', () => {
    expect(() => pickDatabaseContainer(null, 'exists', 'aoox-db-x')).toThrow(
      ConflictException,
    );
  });
});
