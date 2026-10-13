import { ForbiddenException } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { DeliveryEventsService } from './delivery-events.service.js';

describe('DeliveryEventsService', () => {
  it('streams compact partner state only for the owner of the provider profile', async () => {
    const prisma = {
      deliveryPartner: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: 'partner-id' })
          .mockResolvedValueOnce({ availability: 'ONLINE', verificationStatus: 'VERIFIED' }),
      },
      delivery: { findFirst: vi.fn().mockResolvedValue(null) },
      deliveryAssignment: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new DeliveryEventsService(prisma as never, {} as never);

    await expect(
      firstValueFrom(service.partnerStream('owner-id', 'partner-id')),
    ).resolves.toMatchObject({
      data: {
        type: 'DELIVERY_PARTNER_SNAPSHOT',
        availability: 'ONLINE',
        verificationStatus: 'VERIFIED',
        active: null,
        offers: [],
      },
    });
    expect(prisma.deliveryPartner.findUnique).toHaveBeenCalledTimes(2);
  });

  it('rejects subscriptions that try to read another partner profile', async () => {
    const prisma = {
      deliveryPartner: { findUnique: vi.fn().mockResolvedValue({ id: 'owned-partner' }) },
    };
    const service = new DeliveryEventsService(prisma as never, {} as never);

    await expect(
      firstValueFrom(service.partnerStream('user-id', 'other-partner')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('checks order ownership before opening a customer tracking stream', async () => {
    const prisma = { order: { findFirst: vi.fn().mockResolvedValue(null) } };
    const service = new DeliveryEventsService(prisma as never, {} as never);

    await expect(firstValueFrom(service.orderStream('user-id', 'other-order'))).rejects.toThrow(
      'Order not found',
    );
  });
});
