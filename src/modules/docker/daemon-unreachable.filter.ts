import { ArgumentsHost, Catch } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import {
  daemonUnreachableException,
  isDaemonConnectError,
} from './daemon-unreachable';

/**
 * A request that reaches for a daemon that is down used to end as a bare 500
 * "Internal server error" (the raw `connect ENOENT` of the socket). It now
 * answers 502 with "The Docker daemon is not reachable (...)"; every other
 * error is handled exactly as before.
 */
@Catch()
export class DaemonUnreachableFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    super.catch(
      isDaemonConnectError(exception)
        ? daemonUnreachableException(exception)
        : exception,
      host,
    );
  }
}
