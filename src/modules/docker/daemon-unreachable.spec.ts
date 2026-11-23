import { ArgumentsHost, InternalServerErrorException } from '@nestjs/common';
import { DaemonUnreachableFilter } from './daemon-unreachable.filter';
import {
  daemonUnreachableException,
  daemonUnreachableReason,
  isDaemonConnectError,
} from './daemon-unreachable';

function nodeError(
  extra: Record<string, unknown>,
  message = 'connect ENOENT x',
) {
  return Object.assign(new Error(message), extra);
}

const socketError = nodeError({
  code: 'ENOENT',
  syscall: 'connect',
  address: '/var/run/docker.sock',
});

describe('isDaemonConnectError', () => {
  it('matches a failed connect to a socket or pipe', () => {
    expect(isDaemonConnectError(socketError)).toBe(true);
    expect(
      isDaemonConnectError(
        nodeError({ code: 'EACCES', syscall: 'connect', address: '/x.sock' }),
      ),
    ).toBe(true);
  });

  it('does not match a TCP error (e.g. the database is down)', () => {
    expect(
      isDaemonConnectError(
        nodeError({
          code: 'ECONNREFUSED',
          syscall: 'connect',
          address: '127.0.0.1',
          port: 5432,
        }),
      ),
    ).toBe(false);
  });

  it('does not match other errors or non-errors', () => {
    expect(isDaemonConnectError(new Error('boom'))).toBe(false);
    expect(
      isDaemonConnectError(
        nodeError({ code: 'ENOENT', syscall: 'open', address: 'x' }),
      ),
    ).toBe(false);
    expect(isDaemonConnectError('connect ENOENT')).toBe(false);
    expect(isDaemonConnectError(null)).toBe(false);
  });
});

describe('daemonUnreachableReason / exception', () => {
  it('keeps the reason short', () => {
    expect(daemonUnreachableReason(new Error('x'.repeat(300)))).toHaveLength(
      163,
    );
  });

  it('builds a 502 that names the reason', () => {
    const ex = daemonUnreachableException(socketError);
    expect(ex.getStatus()).toBe(502);
    expect(ex.message).toBe(
      'The Docker daemon is not reachable (connect ENOENT x).',
    );
  });
});

describe('DaemonUnreachableFilter', () => {
  function run(exception: unknown) {
    const reply = jest.fn();
    const adapter = { reply, isHeadersSent: () => false };
    const filter = new DaemonUnreachableFilter(adapter as never);
    const host = {
      getType: () => 'http',
      getArgByIndex: (i: number) => (i === 1 ? {} : {}),
      switchToHttp: () => ({ getResponse: () => ({}), getRequest: () => ({}) }),
    } as unknown as ArgumentsHost;
    filter.catch(exception, host);
    return reply.mock.calls[0] as [
      unknown,
      { statusCode: number; message: string },
      number,
    ];
  }

  it('answers 502 for a daemon connect error', () => {
    const [, body, status] = run(socketError);
    expect(status).toBe(502);
    expect(body.message).toContain('The Docker daemon is not reachable');
  });

  it('leaves other errors as they were', () => {
    expect(run(new Error('boom'))[2]).toBe(500);
    expect(run(new InternalServerErrorException('x'))[2]).toBe(500);
  });
});
