import { NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { SandboxPaymentProvider } from './sandbox-payment.provider.js';

describe('SandboxPaymentProvider', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSandboxPayments = process.env.ENABLE_SANDBOX_PAYMENTS;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalSandboxPayments === undefined) delete process.env.ENABLE_SANDBOX_PAYMENTS;
    else process.env.ENABLE_SANDBOX_PAYMENTS = originalSandboxPayments;
  });

  it('refuses to expose sandbox simulation outside test mode', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ENABLE_SANDBOX_PAYMENTS;
    const provider = new SandboxPaymentProvider();

    expect(() => provider.createSession('attempt-id')).toThrow(NotFoundException);
    expect(provider.verify({} as never, 'a'.repeat(64))).toBe(false);
  });

  it('allows explicit non-production opt-in but never allows production simulation', () => {
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_SANDBOX_PAYMENTS = 'true';
    const provider = new SandboxPaymentProvider();

    expect(provider.createSession('attempt-id').checkoutUrl).toBe('test-payment://attempt-id');
    process.env.NODE_ENV = 'production';
    expect(() => provider.createSession('attempt-id')).toThrow(NotFoundException);
  });

  it('signs normalized events and rejects payload or signature tampering', () => {
    process.env.NODE_ENV = 'test';
    const provider = new SandboxPaymentProvider();
    const event = provider.createEvent(
      {
        id: '20000000-0000-4000-8000-000000000001',
        orderIntentId: '10000000-0000-4000-8000-000000000001',
        providerReference: 'sandbox_attempt',
        amountMinor: 1250,
        currency: 'INR',
      },
      'SUCCEEDED',
    );
    const signature = provider.sign(event);

    expect(provider.verify(event, signature)).toBe(true);
    expect(provider.verify({ ...event, amountMinor: 1251 }, signature)).toBe(false);
    expect(provider.verify(event, '0'.repeat(64))).toBe(false);
  });
});
