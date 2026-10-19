import { ConflictException } from '@nestjs/common';
import { assertNotStarting } from './database-starting';

describe('assertNotStarting', () => {
  it('answers 409 only while the database is creating', () => {
    expect(() => assertNotStarting({ status: 'creating' })).toThrow(
      ConflictException,
    );
    for (const status of ['running', 'stopped', 'error']) {
      expect(() => assertNotStarting({ status })).not.toThrow();
    }
  });
});
