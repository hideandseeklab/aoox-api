import { BadRequestException, ConflictException } from '@nestjs/common';
import { pickComposeContainer } from './compose-service-pick';

const c = (id: string, service: string, state = 'running') => ({
  id,
  name: `x-${service}-1`,
  service,
  state,
  status: '',
});

describe('pickComposeContainer', () => {
  it('uses the only service when none is given', () => {
    expect(pickComposeContainer([c('1', 'web')], undefined, 'running').id).toBe(
      '1',
    );
  });

  it('requires a service when there are several and lists them', () => {
    const list = [c('1', 'web'), c('2', 'db')];
    expect(() => pickComposeContainer(list, undefined, 'exists')).toThrow(
      /db, web/,
    );
    expect(() => pickComposeContainer(list, undefined, 'exists')).toThrow(
      BadRequestException,
    );
  });

  it('rejects an unknown service with the list of services', () => {
    expect(() =>
      pickComposeContainer([c('1', 'web')], 'nope', 'exists'),
    ).toThrow(/Unknown service "nope".*web/);
  });

  it('picks the running container of a scaled service', () => {
    const list = [c('1', 'web', 'exited'), c('2', 'web')];
    expect(pickComposeContainer(list, 'web', 'running').id).toBe('2');
  });

  it('console needs it running (409); logs accept a stopped one', () => {
    const list = [c('1', 'web', 'exited')];
    expect(() => pickComposeContainer(list, 'web', 'running')).toThrow(
      ConflictException,
    );
    expect(pickComposeContainer(list, 'web', 'exists').id).toBe('1');
  });

  it('409 when the stack has no containers', () => {
    expect(() => pickComposeContainer([], 'web', 'exists')).toThrow(
      ConflictException,
    );
  });
});
