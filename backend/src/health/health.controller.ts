import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'ssc-prep-hub-api',
      timestamp: new Date().toISOString(),
    };
  }
}
