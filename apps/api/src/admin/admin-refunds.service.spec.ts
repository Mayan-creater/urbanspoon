import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AdminService } from './admin.service.js';

function setup() {
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    paymentAttempt: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'attempt-id',
        status: 'SUCCEEDED',
        amountMinor: 2000,
        currency: 'INR',
        orderIntent: { id: 'intent-id', order: { id: 'order-id' } },
      }),
    },
    refund: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { amountMinor: 1500 } }),
      create: vi.fn().mockResolvedValue({ id: 'refund-id', status: 'REQUESTED' }),
      findUnique: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'refund-id', status: 'SUBMITTED' }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    refund: { findUnique: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
      operation(transaction),
    ),
  };
  return { transaction, prisma, service: new AdminService(prisma as never) };
}

describe('AdminService refund operations', () => {
  it('serializes and rejects a manual refund that would exceed the captured amount', async () => {
    const { transaction, service } = setup();

    await expect(
      service.requestRefund(
        { id: 'requester-id' } as never,
        { paymentAttemptId: 'attempt-id', amountMinor: 501, reason: 'Customer request' },
        'refund-idempotency-key-001',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(transaction.refund.create).not.toHaveBeenCalled();
  });

  it('queues a requested refund for review without running a payment provider', async () => {
    const { transaction, service } = setup();

    await expect(
      service.requestRefund(
        { id: 'requester-id' } as never,
        {
          paymentAttemptId: 'attempt-id',
          amountMinor: 400,
          restaurantAdjustmentMinor: 100,
          reason: 'Customer request',
        },
        'refund-idempotency-key-001',
      ),
    ).resolves.toMatchObject({ id: 'refund-id', status: 'REQUESTED' });

    expect(transaction.refund.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'REQUESTED',
        currency: 'INR',
        amountMinor: 400,
        restaurantAdjustmentMinor: 100,
      }),
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'MANUAL_REFUND_REQUESTED' }),
    });
  });

  it('prevents the requester from approving their own refund', async () => {
    const { transaction, service } = setup();
    transaction.refund.findUnique.mockResolvedValue({
      id: 'refund-id',
      status: 'REQUESTED',
      requestedByUserId: 'requester-id',
    });

    await expect(
      service.approveRefund({ id: 'requester-id' } as never, 'refund-id'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.refund.updateMany).not.toHaveBeenCalled();
  });
});
