import { Controller, Get } from '@nestjs/common';
import { HealthStatus } from '@hexly/domain';

@Controller()
export class HealthController {
  @Get('health')
  getHealth(): HealthStatus {
    return { status: 'ok', service: 'api' };
  }
}
