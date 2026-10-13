import { describe, expect, it } from 'vitest';
import type { HealthResponse, ReadinessResponse } from './index.js';

describe('health contracts', () => {
  it('models the liveness and readiness response shapes', () => {
    const health: HealthResponse = { status: 'ok', timestamp: new Date(0).toISOString() };
    const readiness: ReadinessResponse = {
      ...health,
      dependencies: { database: 'connected' },
    };

    expect(readiness.dependencies.database).toBe('connected');
  });
});
