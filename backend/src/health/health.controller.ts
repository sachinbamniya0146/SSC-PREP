import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { SkipThrottle } from '@nestjs/throttler';

@Controller('health')
@SkipThrottle()
export class HealthController {
  @Public()
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'ssc-prep-hub-api',
      timestamp: new Date().toISOString(),
    };
  }
}
