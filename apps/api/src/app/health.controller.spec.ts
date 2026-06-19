import { Test } from '@nestjs/testing';
import { isHealthy } from '@hexly/domain';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('reports the api as healthy', () => {
    const status = controller.getHealth();
    expect(status).toEqual({ status: 'ok', service: 'api' });
    expect(isHealthy(status)).toBe(true);
  });
});
