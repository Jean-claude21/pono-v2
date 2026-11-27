import { describe, expect, it, vi } from 'vitest';
import { deployEnvironment, initMonitoring, reportError, scrub } from '../src/platform/monitor.js';

describe('error monitoring (D-046)', () => {
  it('sends only the method, the path and an id: no query, header, cookie, body or name', () => {
    const event = scrub({
      request: {
        method: 'POST',
        url: 'https://pono.kete.digital/v1/connections?token=sk_live_x',
        headers: { cookie: 'session=abc', authorization: 'Bearer t' },
        cookies: { session: 'abc' },
        data: '{"token":"x"}',
        query_string: 'token=sk_live_x',
      },
      user: { id: 'p-1', email: 'ada@example.com', username: 'ada', ip_address: '1.2.3.4' },
    });
    expect(event.request).toEqual({
      method: 'POST',
      url: 'https://pono.kete.digital/v1/connections',
    });
    expect(event.user).toEqual({ id: 'p-1' });
    expect(scrub({ user: { email: 'ada@example.com' } }).user).toBeUndefined();
  });

  it('names the environment from the public address', () => {
    expect(deployEnvironment('https://pono.kete.digital', 'production')).toBe('production');
    expect(deployEnvironment('https://staging.pono.kete.digital', 'production')).toBe('staging');
    expect(deployEnvironment('http://localhost:3000', 'development')).toBe('development');
  });

  it('stays off without a DSN or in tests, and still logs the error', () => {
    expect(
      initMonitoring({
        dsn: undefined,
        publicUrl: 'https://pono.kete.digital',
        nodeEnv: 'production',
      }),
    ).toBe(false);
    expect(
      initMonitoring({
        dsn: 'https://k@o1.ingest.de.sentry.io/1',
        publicUrl: 'https://p',
        nodeEnv: 'test',
      }),
    ).toBe(false);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(reportError(new Error('boom'), { where: 'api' })).toBeUndefined();
    expect(log).toHaveBeenCalledWith('[api]', expect.any(Error));
    log.mockRestore();
  });
});
