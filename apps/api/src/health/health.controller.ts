import { Controller, Get } from '@nestjs/common';
import type { HealthResponse, ReadinessResponse } from '@urbanspoon/contracts';
import { Public } from '../auth/auth.decorators.js';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Public()
  live(): HealthResponse {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @Public()
  ready(): Promise<ReadinessResponse> {
    return this.healthService.checkReadiness();
  }
}
