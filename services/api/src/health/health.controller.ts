import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators';

export interface HealthReport {
  status: 'ok';
  service: 'une-api';
  timestamp: string;
}

@Controller('health')
export class HealthController {
  @Get()
  @Public()
  health(): HealthReport {
    return {
      status: 'ok',
      service: 'une-api',
      timestamp: new Date().toISOString(),
    };
  }
}
