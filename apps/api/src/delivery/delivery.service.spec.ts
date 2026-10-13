import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { DeliveryPartnerController } from './delivery.controller.js';
import { DeliveryService } from './delivery.service.js';

describe('DeliveryService', () => {
  it('creates an unverified provider-scoped partner profile idempotently', async () => {
    const profile = {
      id: 'partner-id',
      userId: 'user-id',
      vehicleType: 'SCOOTER',
      verificationStatus: 'PENDING',
      availability: 'OFFLINE',
    };
    const transaction = {
      deliveryPartner: {
        findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(profile),
        create: vi.fn().mockResolvedValue(profile),
      },
      userRole: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
      deliveryPartner: { findUnique: vi.fn().mockResolvedValue(profile) },
    };
    const service = new DeliveryService(prisma as never);

    await expect(service.onboard('user-id', { vehicleType: 'SCOOTER' })).resolves.toEqual(profile);
    await expect(service.onboard('user-id', { vehicleType: 'SCOOTER' })).resolves.toEqual(profile);
    expect(transaction.userRole.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        role: 'delivery_partner',
        scopeType: 'PROVIDER',
        scopeId: 'partner-id',
        grantedByUserId: 'user-id',
      },
    });
    expect(transaction.deliveryPartner.create).toHaveBeenCalledOnce();
  });

  it('does not let pending partners go online', async () => {
    const prisma = {
      deliveryPartner: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'partner-id',
          verificationStatus: 'PENDING',
          availability: 'OFFLINE',
        }),
      },
    };
    const service = new DeliveryService(prisma as never);

    await expect(service.setAvailability('user-id', { isOnline: true })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('requires and stores only a provider reference for external verification', async () => {
    const pending = { id: 'partner-id', verificationStatus: 'PENDING' };
    const transaction = {
      deliveryPartner: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          ...pending,
          verificationStatus: 'VERIFIED',
          verificationProvider: 'EXTERNAL',
          verificationReference: 'case-reference-1234',
        }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      deliveryPartner: { findUnique: vi.fn().mockResolvedValue(pending) },
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new DeliveryService(prisma as never);

    await expect(
      service.verifyPartner('admin-id', 'partner-id', true, undefined, 'EXTERNAL'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.verifyPartner(
        'admin-id',
        'partner-id',
        true,
        undefined,
        'EXTERNAL',
        'case-reference-1234',
      ),
    ).resolves.toMatchObject({ verificationProvider: 'EXTERNAL' });
    expect(transaction.deliveryPartner.updateMany).toHaveBeenCalledWith({
      where: { id: 'partner-id', verificationStatus: 'PENDING' },
      data: expect.objectContaining({
        verificationProvider: 'EXTERNAL',
        verificationReference: 'case-reference-1234',
      }),
    });
  });

  it('requires identity and vehicle documents before manual verification', async () => {
    const pending = { id: 'partner-id', verificationStatus: 'PENDING' };
    const prisma = {
      deliveryPartner: { findUnique: vi.fn().mockResolvedValue(pending) },
      deliveryEvidence: {
        findMany: vi.fn().mockResolvedValue([{ evidenceType: 'IDENTITY' }]),
      },
      $transaction: vi.fn(),
    };
    const service = new DeliveryService(prisma as never);

    await expect(service.verifyPartner('admin-id', 'partner-id', true)).rejects.toThrow(
      'Manual approval requires identity and vehicle documents',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('offers a pending delivery to the nearest eligible partner with a fresh location', async () => {
    const delivery = {
      id: 'delivery-id',
      status: 'PENDING_ASSIGNMENT',
      deliveryPartnerId: null,
      order: {
        restaurant: { latitude: 12.9716, longitude: 77.5946 },
      },
    };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      delivery: { findUnique: vi.fn().mockResolvedValue(delivery) },
      deliveryAssignment: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]),
        create: vi.fn().mockResolvedValue({ id: 'offer-id', deliveryPartnerId: 'closest-partner' }),
      },
      deliveryPartner: {
        findUnique: vi.fn().mockResolvedValue({
          verificationStatus: 'VERIFIED',
          availability: 'ONLINE',
          updatedAt: new Date(),
        }),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'farther-partner',
            locations: [{ latitude: 13.0, longitude: 77.62 }],
          },
          {
            id: 'closest-partner',
            locations: [{ latitude: 12.972, longitude: 77.595 }],
          },
        ]),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new DeliveryService(prisma as never);

    await expect(service.dispatch('delivery-id', 'admin-user')).resolves.toMatchObject({
      id: 'offer-id',
      deliveryPartnerId: 'closest-partner',
    });
    expect(transaction.deliveryAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deliveryId: 'delivery-id',
        deliveryPartnerId: 'closest-partner',
        expiresAt: expect.any(Date),
      }),
    });
    expect(transaction.deliveryPartner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ verificationStatus: 'VERIFIED', availability: 'ONLINE' }),
        include: {
          locations: expect.objectContaining({
            where: { recordedAt: { gte: expect.any(Date) } },
          }),
        },
      }),
    );
  });

  it('delays dispatch until the restaurant prep window reaches its lead time', async () => {
    const now = Date.now();
    const delivery = {
      id: 'delivery-id',
      status: 'PENDING_ASSIGNMENT',
      deliveryPartnerId: null,
      dispatchAt: new Date(now + 35 * 60_000),
    };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      delivery: {
        create: vi.fn().mockImplementation(({ data }) => ({ ...data, id: 'delivery-id' })),
        findUnique: vi.fn().mockResolvedValue(delivery),
      },
      deliveryStatusHistory: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new DeliveryService(prisma as never);

    const result = await service.createForAcceptedOrder(
      transaction as never,
      'order-id',
      'staff-id',
      45,
    );

    expect(transaction.delivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-id',
        estimatedPreparationMinutes: 45,
        estimatedReadyAt: expect.any(Date),
        dispatchAt: expect.any(Date),
      }),
    });
    expect(result.initialOfferId).toBeNull();
  });

  it('conditionally claims partner availability before accepting an offer', async () => {
    const transaction = {
      deliveryPartner: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'partner-id',
          verificationStatus: 'VERIFIED',
          availability: 'ONLINE',
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      deliveryAssignment: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'assignment-id',
          deliveryId: 'delivery-id',
          deliveryPartnerId: 'partner-id',
          status: 'OFFERED',
          expiresAt: new Date(Date.now() + 60_000),
          delivery: { id: 'delivery-id' },
        }),
      },
      delivery: { updateMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new DeliveryService(prisma as never);

    await expect(service.acceptOffer('user-id', 'assignment-id')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(transaction.delivery.updateMany).not.toHaveBeenCalled();
  });

  it('verifies the customer code and completes the delivery, order, and base earning atomically', async () => {
    const oldSecret = process.env.DELIVERY_OTP_SECRET;
    const oldAmount = process.env.DELIVERY_BASE_EARNING_MINOR;
    const oldDistanceRate = process.env.DELIVERY_DISTANCE_EARNING_MINOR_PER_KM;
    const oldIncentive = process.env.DELIVERY_COMPLETION_INCENTIVE_MINOR;
    process.env.DELIVERY_OTP_SECRET = 'delivery-test-secret';
    process.env.DELIVERY_BASE_EARNING_MINOR = '725';
    process.env.DELIVERY_DISTANCE_EARNING_MINOR_PER_KM = '100';
    process.env.DELIVERY_COMPLETION_INCENTIVE_MINOR = '250';
    const deliveryId = 'delivery-id';
    const deliveryCode =
      createHmac('sha256', process.env.DELIVERY_OTP_SECRET)
        .update(deliveryId)
        .digest()
        .readUInt32BE(0) % 1_000_000;
    const paddedCode = deliveryCode.toString().padStart(6, '0');
    const delivery = {
      id: deliveryId,
      orderId: 'order-id',
      deliveryPartnerId: 'partner-id',
      deliveryOtpHash: createHash('sha256').update(`${deliveryId}:${paddedCode}`).digest('hex'),
      status: 'ARRIVED',
      order: {
        id: 'order-id',
        status: 'PICKED_UP',
        currency: 'INR',
        orderSnapshot: { address: { latitude: 0.01, longitude: 0.01 } },
        restaurant: { latitude: 0, longitude: 0 },
      },
    };
    const transaction = {
      deliveryPartner: {
        findUnique: vi.fn().mockResolvedValue({ id: 'partner-id', availability: 'BUSY' }),
        update: vi.fn().mockResolvedValue({}),
      },
      delivery: {
        findFirst: vi.fn().mockResolvedValue(delivery),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...delivery, status: 'DELIVERED' }),
      },
      deliveryStatusHistory: { create: vi.fn().mockResolvedValue({}) },
      order: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'order-id',
          userId: 'customer-id',
          currency: 'INR',
          subtotalMinor: 10_000,
          discountMinor: 0,
        }),
      },
      loyaltyRule: {
        findFirst: vi.fn().mockResolvedValue({ id: 'loyalty-rule-id', version: 1, earnRateBps: 100 }),
      },
      loyaltyTransaction: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { points: 0 } }),
        upsert: vi.fn().mockResolvedValue({ points: 100 }),
      },
      orderStatusHistory: { create: vi.fn().mockResolvedValue({}) },
      partnerEarning: { upsert: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new DeliveryService(prisma as never);

    try {
      await expect(
        service.completeDelivery('user-id', { deliveryCode: paddedCode, cashTipMinor: 250 }),
      ).resolves.toMatchObject({
        status: 'DELIVERED',
      });
      expect(transaction.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'order-id', status: 'PICKED_UP' },
        data: { status: 'DELIVERED' },
      });
      expect(transaction.loyaltyTransaction.upsert).toHaveBeenCalledWith({
        where: { idempotencyKey: 'order:order-id:loyalty:earn' },
        create: expect.objectContaining({ userId: 'customer-id', points: 100, type: 'EARN' }),
        update: {},
      });
      expect(transaction.partnerEarning.upsert).toHaveBeenCalledWith({
        where: { deliveryId_earningType: { deliveryId, earningType: 'BASE' } },
        create: expect.objectContaining({ amountMinor: 725, currency: 'INR' }),
        update: {},
      });
      expect(transaction.partnerEarning.upsert).toHaveBeenCalledWith({
        where: { deliveryId_earningType: { deliveryId, earningType: 'TIP' } },
        create: expect.objectContaining({
          earningType: 'TIP',
          amountMinor: 250,
          status: 'PAID',
          calculation: expect.objectContaining({
            formula: 'cash_tip_received_by_partner',
            paidOutsidePlatform: true,
          }),
        }),
        update: {},
      });
      expect(transaction.partnerEarning.upsert).toHaveBeenCalledWith({
        where: { deliveryId_earningType: { deliveryId, earningType: 'DISTANCE' } },
        create: expect.objectContaining({
          earningType: 'DISTANCE',
          amountMinor: expect.any(Number),
          calculation: expect.objectContaining({
            formula: 'straight_line_km_times_rate',
            rateMinorPerKm: 100,
          }),
        }),
        update: {},
      });
      expect(transaction.partnerEarning.upsert).toHaveBeenCalledWith({
        where: { deliveryId_earningType: { deliveryId, earningType: 'INCENTIVE' } },
        create: expect.objectContaining({
          earningType: 'INCENTIVE',
          amountMinor: 250,
          calculation: expect.objectContaining({ formula: 'configured_completion_incentive' }),
        }),
        update: {},
      });
    } finally {
      if (oldSecret === undefined) delete process.env.DELIVERY_OTP_SECRET;
      else process.env.DELIVERY_OTP_SECRET = oldSecret;
      if (oldAmount === undefined) delete process.env.DELIVERY_BASE_EARNING_MINOR;
      else process.env.DELIVERY_BASE_EARNING_MINOR = oldAmount;
      if (oldDistanceRate === undefined) delete process.env.DELIVERY_DISTANCE_EARNING_MINOR_PER_KM;
      else process.env.DELIVERY_DISTANCE_EARNING_MINOR_PER_KM = oldDistanceRate;
      if (oldIncentive === undefined) delete process.env.DELIVERY_COMPLETION_INCENTIVE_MINOR;
      else process.env.DELIVERY_COMPLETION_INCENTIVE_MINOR = oldIncentive;
    }
  });

  it('derives payout amount from completed pending earnings and reserves them idempotently', async () => {
    const periodEnd = new Date(Date.now() - 1000).toISOString();
    const periodStart = new Date(Date.now() - 7 * 86400_000).toISOString();
    const payout = { id: 'payout-id', deliveryPartnerId: 'partner-id', amountMinor: 1200 };
    const earnings = [
      { id: 'earning-1', amountMinor: 500 },
      { id: 'earning-2', amountMinor: 700 },
    ];
    const transaction = {
      deliveryPartner: {
        findUnique: vi.fn().mockResolvedValue({ id: 'partner-id', marketRegion: 'IN' }),
      },
      partnerPayout: {
        findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(payout),
        create: vi.fn().mockResolvedValue(payout),
        findUniqueOrThrow: vi.fn().mockResolvedValue(payout),
      },
      partnerEarning: {
        findMany: vi.fn().mockResolvedValue(earnings),
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
      deliveryPartner: {
        findUnique: vi.fn().mockResolvedValue({ id: 'partner-id', marketRegion: 'IN' }),
      },
      partnerPayout: { findUnique: vi.fn() },
    };
    const service = new DeliveryService(prisma as never);
    const input = { from: periodStart, to: periodEnd, currency: 'INR' };

    await expect(
      service.requestPayout('user-id', input, 'payout-request-key-0001'),
    ).resolves.toEqual(payout);
    await expect(
      service.requestPayout('user-id', input, 'payout-request-key-0001'),
    ).resolves.toEqual(payout);
    expect(transaction.partnerPayout.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amountMinor: 1200,
        currency: 'INR',
        provider: 'RAZORPAY_ROUTE',
      }),
    });
    expect(transaction.partnerEarning.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['earning-1', 'earning-2'] }, status: 'PENDING', payoutId: null },
      data: { status: 'PAYOUT_REQUESTED', payoutId: 'payout-id' },
    });
  });

  it('blocks payout requests for markets without a configured compliant provider', async () => {
    const prisma = {
      deliveryPartner: {
        findUnique: vi.fn().mockResolvedValue({ id: 'partner-id', marketRegion: 'CN' }),
      },
      $transaction: vi.fn(),
    };
    const service = new DeliveryService(prisma as never);
    const input = {
      from: new Date(Date.now() - 86400_000).toISOString(),
      to: new Date(Date.now() - 1000).toISOString(),
      currency: 'CNY',
    };

    await expect(
      service.requestPayout('user-id', input, 'payout-request-key-0002'),
    ).rejects.toThrow('Payouts in CNY are not enabled for the CN market');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns rejected payout earnings to the available balance', async () => {
    const payout = { id: 'payout-id', status: 'REQUESTED', earnings: [] };
    const transaction = {
      partnerPayout: {
        findUnique: vi.fn().mockResolvedValue(payout),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...payout, status: 'REJECTED' }),
      },
      partnerEarning: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new DeliveryService(prisma as never);

    await service.decidePayout('admin-id', 'payout-id', 'reject', 'Transfer details invalid');

    expect(transaction.partnerEarning.updateMany).toHaveBeenCalledWith({
      where: { payoutId: 'payout-id', status: 'PAYOUT_REQUESTED' },
      data: { status: 'PENDING', payoutId: null },
    });
  });

  it('requires approval before marking a payout paid and records the transfer reference', async () => {
    const payout = { id: 'payout-id', status: 'REQUESTED', earnings: [] as unknown[] };
    const transaction = {
      partnerPayout: {
        findUnique: vi.fn().mockImplementation(async () => ({ ...payout })),
        updateMany: vi.fn().mockImplementation(async ({ data }: { data: { status: string } }) => {
          payout.status = data.status;
          return { count: 1 };
        }),
        findUniqueOrThrow: vi.fn().mockImplementation(async () => ({ ...payout })),
      },
      partnerEarning: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new DeliveryService(prisma as never);

    await expect(
      service.decidePayout('admin-id', 'payout-id', 'mark-paid', undefined, 'bank-ref-1234'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(service.decidePayout('admin-id', 'payout-id', 'approve')).resolves.toMatchObject({
      status: 'APPROVED',
    });
    await expect(
      service.decidePayout('admin-id', 'payout-id', 'mark-paid', undefined, 'bank-ref-1234'),
    ).resolves.toMatchObject({ status: 'PAID' });
    expect(transaction.partnerPayout.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'payout-id', status: 'APPROVED' },
      data: expect.objectContaining({ status: 'PAID', providerReference: 'bank-ref-1234' }),
    });
    expect(transaction.partnerEarning.updateMany).toHaveBeenLastCalledWith({
      where: { payoutId: 'payout-id', status: 'APPROVED' },
      data: { status: 'PAID' },
    });
  });

  it('settles an approved payout idempotently through the no-money sandbox adapter', async () => {
    const oldMode = process.env.DELIVERY_PAYOUT_MODE;
    process.env.DELIVERY_PAYOUT_MODE = 'sandbox';
    const payout = {
      id: 'payout-id',
      status: 'APPROVED',
      providerReference: null,
      earnings: [],
    };
    const transaction = {
      partnerPayout: {
        findUnique: vi.fn().mockResolvedValue({ ...payout }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          ...payout,
          status: 'PAID',
          providerReference: 'sandbox-payout-id',
        }),
      },
      partnerEarning: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      partnerPayout: { findUnique: vi.fn().mockResolvedValue(payout) },
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new DeliveryService(prisma as never);

    try {
      await expect(service.executeSandboxPayout('admin-id', 'payout-id')).resolves.toMatchObject({
        status: 'PAID',
        providerReference: 'sandbox-payout-id',
        transferMode: 'SANDBOX_NO_FUNDS_MOVED',
      });
      expect(transaction.partnerEarning.updateMany).toHaveBeenCalledWith({
        where: { payoutId: 'payout-id', status: 'APPROVED' },
        data: { status: 'PAID' },
      });
    } finally {
      if (oldMode === undefined) delete process.env.DELIVERY_PAYOUT_MODE;
      else process.env.DELIVERY_PAYOUT_MODE = oldMode;
    }
  });

  it('scopes partner routes to the caller provider profile permission', () => {
    expect(Reflect.getMetadata('permissionRequirement', DeliveryPartnerController)).toEqual({
      permission: 'delivery.self.manage',
      scopeType: 'PROVIDER',
      scopeParam: 'partnerId',
    });
  });
});
