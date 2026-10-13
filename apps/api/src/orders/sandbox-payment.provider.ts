import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { SandboxPaymentWebhookDto } from './order-intents.dto.js';

@Injectable()
export class SandboxPaymentProvider {
  readonly name = 'sandbox';

  assertTestMode() {
    if (process.env.NODE_ENV !== 'test') {
      throw new NotFoundException('Sandbox payment simulation is available only in test mode');
    }
  }

  assertAvailable() {
    if (
      process.env.NODE_ENV !== 'test' &&
      (process.env.NODE_ENV === 'production' || process.env.ENABLE_SANDBOX_PAYMENTS !== 'true')
    ) {
      throw new NotFoundException('Sandbox payment simulation is disabled');
    }
  }

  createSession(attemptId: string) {
    this.assertAvailable();
    return {
      providerReference: `sandbox_${attemptId}`,
      checkoutUrl: `test-payment://${attemptId}`,
    };
  }

  createEvent(
    attempt: {
      id: string;
      orderIntentId: string;
      providerReference: string | null;
      amountMinor: number;
      currency: string;
    },
    outcome: 'SUCCEEDED' | 'FAILED',
  ): SandboxPaymentWebhookDto {
    this.assertAvailable();
    return {
      providerEventId: randomUUID(),
      type: outcome === 'SUCCEEDED' ? 'PAYMENT_SUCCEEDED' : 'PAYMENT_FAILED',
      paymentAttemptId: attempt.id,
      orderIntentId: attempt.orderIntentId,
      providerReference: attempt.providerReference ?? '',
      amountMinor: attempt.amountMinor,
      currency: attempt.currency,
      ...(outcome === 'FAILED' ? { failureCode: 'SANDBOX_DECLINED' } : {}),
    };
  }

  sign(event: SandboxPaymentWebhookDto): string {
    this.assertAvailable();
    return createHmac('sha256', this.secret()).update(this.canonicalPayload(event)).digest('hex');
  }

  verify(event: SandboxPaymentWebhookDto, signature: string | undefined): boolean {
    try {
      this.assertAvailable();
    } catch {
      return false;
    }
    if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) {
      return false;
    }
    const expected = Buffer.from(
      createHmac('sha256', this.secret()).update(this.canonicalPayload(event)).digest('hex'),
      'hex',
    );
    const received = Buffer.from(signature, 'hex');
    return received.length === expected.length && timingSafeEqual(expected, received);
  }

  executeRefund(idempotencyKey: string) {
    this.assertAvailable();
    const reference = createHmac('sha256', this.secret()).update(idempotencyKey).digest('hex');
    return { providerReference: `sandbox_refund_${reference.slice(0, 32)}` };
  }

  private canonicalPayload(event: SandboxPaymentWebhookDto) {
    return JSON.stringify({
      providerEventId: event.providerEventId,
      type: event.type,
      paymentAttemptId: event.paymentAttemptId,
      orderIntentId: event.orderIntentId,
      providerReference: event.providerReference,
      amountMinor: event.amountMinor,
      currency: event.currency,
      failureCode: event.failureCode ?? null,
    });
  }

  private secret() {
    return process.env.TEST_PAYMENT_WEBHOOK_SECRET ?? 'urban-spoon-test-webhook-secret';
  }
}
