import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SupportService } from './support.service.js';

describe('SupportService', () => {
  it('requires owned orders for order-related cases and rejects another customer order', async () => {
    const prisma = {
      supportCase: { findUnique: vi.fn().mockResolvedValue(null) },
      order: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new SupportService(prisma as never);
    const input = {
      category: 'PAYMENT' as const,
      orderId: 'other-order',
      subject: 'Payment charged twice',
      message: 'I see two charges for the same order on my statement.',
    };

    await expect(
      service.createCase('user', input, 'support-request-key-0001'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.createCase('user', { ...input, orderId: undefined }, 'support-request-key-0002'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns an existing case for an idempotent customer retry', async () => {
    const existing = { id: 'case-id', status: 'OPEN', messages: [] };
    const prisma = {
      supportCase: { findUnique: vi.fn().mockResolvedValue(existing) },
      order: { findFirst: vi.fn() },
    };
    const service = new SupportService(prisma as never);

    await expect(
      service.createCase(
        'user',
        {
          category: 'ACCOUNT',
          subject: 'Update my email',
          message: 'I need to update my email address.',
        },
        'support-request-key-0001',
      ),
    ).resolves.toEqual(existing);
    expect(prisma.order.findFirst).not.toHaveBeenCalled();
  });

  it('allows assigned agents to read details only through an assignment-scoped query', async () => {
    const prisma = {
      supportCase: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new SupportService(prisma as never);

    await expect(service.getAssignedCase('agent-a', 'case-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.supportCase.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'case-id', assignedToUserId: 'agent-a' } }),
    );
  });

  it('filters internal notes from customer case details', async () => {
    const prisma = {
      supportCase: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'case-id', messages: [{ body: 'Public reply' }] }),
      },
    };
    const service = new SupportService(prisma as never);

    await expect(service.getCustomerCase('customer-a', 'case-id')).resolves.toMatchObject({
      messages: [{ body: 'Public reply' }],
    });
    expect(prisma.supportCase.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'case-id', userId: 'customer-a' },
        include: expect.objectContaining({
          messages: expect.objectContaining({ where: { isInternal: false } }),
        }),
      }),
    );
  });

  it('does not let agents claim a case already claimed by someone else', async () => {
    const prisma = {
      supportCase: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'case-id',
          assignedToUserId: 'agent-b',
          status: 'IN_PROGRESS',
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const service = new SupportService(prisma as never);

    await expect(service.claimCase('agent-a', 'case-id')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.supportCase.updateMany).toHaveBeenCalledWith({
      where: { id: 'case-id', assignedToUserId: null, status: 'OPEN' },
      data: { assignedToUserId: 'agent-a', status: 'IN_PROGRESS' },
    });
  });

  it('records an audited customer outcome when an assigned agent resolves a case', async () => {
    const transaction = {
      supportCase: {
        findFirst: vi.fn().mockResolvedValue({ id: 'case-id', status: 'IN_PROGRESS' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'case-id', status: 'RESOLVED' }),
      },
      supportMessage: { create: vi.fn().mockResolvedValue({ id: 'outcome-message' }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new SupportService(prisma as never);

    await expect(
      service.resolveCase('agent-a', 'case-id', {
        resolutionSummary: 'Duplicate payment was confirmed.',
        customerOutcome: 'We initiated a refund for the duplicate charge.',
      }),
    ).resolves.toMatchObject({ status: 'RESOLVED' });
    expect(transaction.supportMessage.create).toHaveBeenCalledWith({
      data: {
        caseId: 'case-id',
        authorUserId: 'agent-a',
        body: 'We initiated a refund for the duplicate charge.',
      },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'SUPPORT_CASE_RESOLVED', entityId: 'case-id' }),
    });
  });
});
