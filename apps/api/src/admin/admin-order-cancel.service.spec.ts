import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from '../orders/orders.service.js';

function setup(status: string) {
  const transaction = {
    order: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'order-id',
        orderIntentId: 'intent-id',
        status,
        confirmingPaymentAttempt: null,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ id: 'order-id', status: 'CANCELLED_BY_ADMIN' }),
    },
    orderStatusHistory: { create: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
      operation(transaction),
    ),
  };
  const delivery = { cancelForOrder: vi.fn().mockResolvedValue(undefined) };
  const service = new OrdersService(prisma as never, {} as never, {} as never, delivery as never);
  return { transaction, delivery, service };
}

describe('OrdersService administrator cancellation', () => {
  it('cancels an eligible order with a required reason and audit history', async () => {
    const { transaction, delivery, service } = setup('PREPARING');

    await service.cancelAdminOrder('admin-id', 'order-id', 'Food safety concern', 'request-id');

    expect(transaction.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-id', status: 'PREPARING' },
      data: { status: 'CANCELLED_BY_ADMIN' },
    });
    expect(transaction.orderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fromStatus: 'PREPARING',
        toStatus: 'CANCELLED_BY_ADMIN',
        reason: 'Food safety concern',
        correlationId: 'request-id',
      }),
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'ORDER_CANCELLED_BY_ADMIN' }),
    });
    expect(delivery.cancelForOrder).toHaveBeenCalledWith(
      transaction,
      'order-id',
      'admin-id',
      'Food safety concern',
    );
  });

  it('rejects cancellation after pickup or delivery', async () => {
    const { transaction, service } = setup('DELIVERED');

    await expect(
      service.cancelAdminOrder('admin-id', 'order-id', 'Customer escalation'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.order.updateMany).not.toHaveBeenCalled();
  });
});
