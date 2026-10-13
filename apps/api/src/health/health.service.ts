import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { ReadinessResponse } from '@urbanspoon/contracts';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async checkReadiness(): Promise<ReadinessResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Database is unavailable');
    }

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      dependencies: { database: 'connected' },
    };
  }
}
