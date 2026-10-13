import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CateringService } from './catering.service.js';

describe('CateringService', () => {
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    cateringQuote: {
      create: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    cateringRequest: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    restaurant: { findUnique: vi.fn(), update: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn((operation: (client: typeof transaction) => unknown) => operation(transaction)),
    cateringRequest: { findFirst: vi.fn(), findMany: vi.fn() },
    restaurant: { findUnique: vi.fn() },
  };
  let service: CateringService;

  beforeEach(() => {
    vi.restoreAllMocks();
    transaction.$queryRaw.mockResolvedValue([]);
    transaction.auditLog.create.mockResolvedValue({});
    transaction.cateringQuote.create.mockResolvedValue({ id: 'quote-id', revision: 3, amountMinor: 80000 });
    transaction.cateringQuote.findFirst.mockResolvedValue({ revision: 2 });
    transaction.cateringQuote.updateMany.mockResolvedValue({ count: 1 });
    transaction.cateringRequest.create.mockResolvedValue({
      id: 'request-id',
      guestCount: 40,
      city: 'Pune',
      eventAt: new Date(Date.now() + 2 * 86_400_000),
    });
    transaction.cateringRequest.findUnique.mockResolvedValue({
      id: 'request-id',
      status: 'OPEN',
      eventAt: new Date(Date.now() + 20 * 86_400_000),
      currency: 'INR',
      city: 'Pune',
      cuisineTypes: ['Indian'],
    });
    transaction.restaurant.findUnique.mockResolvedValue({
      id: 'restaurant-id',
      name: 'Local Kitchen',
      status: 'ACTIVE',
      supportsCatering: true,
      city: 'Pune',
      cuisineTypes: ['Indian', 'Gujarati'],
    });
    prisma.cateringRequest.findFirst.mockResolvedValue({ id: 'request-id', status: 'OPEN' });
    prisma.cateringRequest.findMany.mockResolvedValue([]);
    service = new CateringService(prisma as never);
  });

  it('creates an event request for the authenticated customer and records an audit event', async () => {
    await service.createRequest('customer-id', {
      guestCount: 40,
      budgetMinor: 100_000,
      cuisineTypes: [' Indian ', 'Indian'],
      occasion: 'Team lunch',
      eventAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      city: ' Pune ',
      state: ' Maharashtra ',
      postalCode: '411001',
      venueAddress: '12 Market Street',
    });

    expect(transaction.cateringRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        customerUserId: 'customer-id',
        currency: 'INR',
        cuisineTypes: ['Indian'],
        city: 'Pune',
      }),
    }));
    expect(transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actorUserId: 'customer-id', action: 'CATERING_REQUEST_SUBMITTED' }),
    }));
  });

  it('rejects past event dates before writing customer data', async () => {
    await expect(service.createRequest('customer-id', {
      guestCount: 40,
      budgetMinor: 100_000,
      cuisineTypes: ['Indian'],
      occasion: 'Team lunch',
      eventAt: new Date(Date.now() - 60_000).toISOString(),
      city: 'Pune',
      state: 'Maharashtra',
      postalCode: '411001',
      venueAddress: '12 Market Street',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('withdraws outstanding quotations when the requester closes an event request', async () => {
    transaction.cateringRequest.update.mockResolvedValue({ id: 'request-id', status: 'WITHDRAWN' });

    await service.withdrawRequest('customer-id', 'request-id');

    expect(transaction.cateringQuote.updateMany).toHaveBeenCalledWith({
      where: { requestId: 'request-id', status: 'SUBMITTED' },
      data: { status: 'WITHDRAWN' },
    });
  });

  it('requires catering opt-in before exposing event venue details to a restaurant', async () => {
    prisma.restaurant.findUnique.mockResolvedValue({
      id: 'restaurant-id',
      status: 'ACTIVE',
      supportsCatering: false,
      city: 'Pune',
      cuisineTypes: ['Indian'],
    });

    await expect(service.listProviderRequests('restaurant-id')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.cateringRequest.findMany).not.toHaveBeenCalled();
  });

  it('serializes quote revisions and supersedes the provider previous submission', async () => {
    const quote = await service.createQuote('partner-id', 'restaurant-id', 'request-id', {
      amountMinor: 80_000,
      taxMinor: 4_000,
      currency: 'INR',
      inclusions: ['Buffet meal', 'Serving staff'],
      message: 'Setup included.',
      validUntil: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    });

    expect(quote).toMatchObject({ id: 'quote-id', revision: 3 });
    expect(transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(transaction.cateringQuote.updateMany).toHaveBeenCalledWith({
      where: { requestId: 'request-id', restaurantId: 'restaurant-id', status: 'SUBMITTED' },
      data: { status: 'SUPERSEDED' },
    });
    expect(transaction.cateringQuote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        requestId: 'request-id',
        restaurantId: 'restaurant-id',
        createdByUserId: 'partner-id',
        revision: 3,
        currency: 'INR',
      }),
    }));
  });

  it('rejects quotes from mismatched city/cuisine and mismatched currency', async () => {
    transaction.restaurant.findUnique.mockResolvedValueOnce({
      id: 'restaurant-id',
      status: 'ACTIVE',
      supportsCatering: true,
      city: 'Mumbai',
      cuisineTypes: ['Indian'],
    });
    const input = {
      amountMinor: 80_000,
      currency: 'INR',
      inclusions: ['Food'],
      validUntil: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    };
    await expect(service.createQuote('partner-id', 'restaurant-id', 'request-id', input))
      .rejects.toBeInstanceOf(ForbiddenException);

    transaction.restaurant.findUnique.mockResolvedValueOnce({
      id: 'restaurant-id',
      status: 'ACTIVE',
      supportsCatering: true,
      city: 'Pune',
      cuisineTypes: ['Indian'],
    });
    await expect(service.createQuote('partner-id', 'restaurant-id', 'request-id', {
      ...input,
      currency: 'USD',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.cateringQuote.create).not.toHaveBeenCalled();
  });
});