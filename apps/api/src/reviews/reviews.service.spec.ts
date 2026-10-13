import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ReviewsService } from './reviews.service.js';

describe('ReviewsService', () => {
  it('requires the customer to own a delivered order before creating a review', async () => {
    const prisma = {
      orderReview: { findUnique: vi.fn().mockResolvedValue(null) },
      order: { findFirst: vi.fn().mockResolvedValue({ id: 'order', status: 'PREPARING' }) },
    };
    const service = new ReviewsService(prisma as never);

    await expect(
      service.create(
        'customer',
        {
          orderId: 'order',
          rating: 5,
          title: 'Great meal',
          body: 'The food arrived hot and tasted great.',
        },
        'review-request-key-0001',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns the original review for an idempotent retry', async () => {
    const review = { id: 'review', orderId: 'order', status: 'PENDING' };
    const prisma = {
      orderReview: { findUnique: vi.fn().mockResolvedValue(review) },
      order: { findFirst: vi.fn() },
    };
    const service = new ReviewsService(prisma as never);

    await expect(
      service.create(
        'customer',
        {
          orderId: 'order',
          rating: 5,
          title: 'Great meal',
          body: 'The food arrived hot and tasted great.',
        },
        'review-request-key-0001',
      ),
    ).resolves.toEqual(review);
    expect(prisma.order.findFirst).not.toHaveBeenCalled();
  });

  it('records a report once and prevents authors from reporting their own review', async () => {
    const report = { id: 'report-id', reviewId: 'review-id', reporterUserId: 'reader' };
    const transaction = {
      reviewReport: { create: vi.fn().mockResolvedValue(report) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      orderReview: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'review-id',
          userId: 'author',
          status: 'PUBLISHED',
        }),
      },
      reviewReport: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new ReviewsService(prisma as never);

    await expect(
      service.report('reader', 'review-id', {
        reason: 'This review contains personal information.',
      }),
    ).resolves.toEqual(report);
    await expect(
      service.report('author', 'review-id', { reason: 'I am reporting my own review.' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.reviewReport.create).toHaveBeenCalledOnce();
  });

  it('requires a moderation reason and dismisses open reports when publishing', async () => {
    const review = { id: 'review', status: 'PENDING' };
    const transaction = {
      orderReview: {
        findUnique: vi.fn().mockResolvedValue(review),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...review, status: 'PUBLISHED' }),
      },
      reviewReport: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new ReviewsService(prisma as never);

    await expect(
      service.moderate('moderator', 'review', { action: 'HIDE' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.moderate('moderator', 'review', { action: 'PUBLISH' }),
    ).resolves.toMatchObject({ status: 'PUBLISHED' });
    expect(transaction.reviewReport.updateMany).toHaveBeenCalledWith({
      where: { reviewId: 'review', status: 'OPEN' },
      data: { status: 'DISMISSED' },
    });
  });
});
