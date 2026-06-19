import { HealthStatus, isHealthy } from './health';

describe('isHealthy', () => {
  it('is true when the service reports ok', () => {
    const status: HealthStatus = { status: 'ok', service: 'api' };
    expect(isHealthy(status)).toBe(true);
  });
});
