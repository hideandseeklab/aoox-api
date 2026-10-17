import { SetMetadata } from '@nestjs/common';

export const THROTTLE_BY_IP_KEY = 'throttleByIp';

/**
 * Forces the rate limit of a public route (sign-in, setup, invitations,
 * webhooks) to stay keyed on the client IP, even if the caller also sends a
 * valid Bearer. Brute-force protection must not depend on identity.
 */
export const ThrottleByIp = () => SetMetadata(THROTTLE_BY_IP_KEY, true);
