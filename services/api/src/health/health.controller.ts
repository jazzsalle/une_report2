import { Controller, Get } from '@nestjs/common';

export interface HealthReport {
  status: 'ok';
  service: 'une-api';
  timestamp: string;
}

@Controller('health')
export class HealthController {
  @Get()
  health(): HealthReport {
    return {
      status: 'ok',
      service: 'une-api',
      timestamp: new Date().toISOString(),
    };
  }
}
