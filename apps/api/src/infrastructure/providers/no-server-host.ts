import type { ProjectServerHost } from '../../features/servers/index.js';
import { AppError } from '../../platform/errors.js';

/** When no server provider is configured: every gesture says so, nothing is pretended. */
export function unavailableServerHost(): ProjectServerHost {
  const refuse = (): never => {
    throw new AppError('servers.unavailable', 503, 'No server provider is configured.');
  };
  return {
    id: 'none',
    create: refuse,
    get: async () => undefined as never,
    sleep: refuse,
    wake: refuse,
    destroy: refuse,
  };
}
