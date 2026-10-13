import { ConflictException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { GroupOrdersService } from './group-orders.service.js';

describe('GroupOrdersService', () => {
  it('creates a group from the host cart and adds the host as a member', async () => {
    const transaction = {
      cart: { findFirst: vi.fn().mockResolvedValue({ id: 'cart-id' }) },
      groupOrder: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'group-id' }),
      },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
      groupOrder: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'group-id',
          hostUserId: 'host-id',
          status: 'OPEN',
          cart: { items: [] },
          members: [],
        }),
      },
    };
    const service = new GroupOrdersService(prisma as never, {} as never, {} as never);

    await expect(service.create('host-id', { cartId: 'cart-id' })).resolves.toMatchObject({
      id: 'group-id',
      status: 'OPEN',
    });
    expect(transaction.groupOrder.create).toHaveBeenCalledWith({
      data: {
        cartId: 'cart-id',
        hostUserId: 'host-id',
        deadlineAt: null,
        members: { create: { userId: 'host-id' } },
      },
      select: { id: true },
    });
  });

  it('stores only an invite-token hash and returns the raw token once', async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      groupOrder: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'group-id',
          hostUserId: 'host-id',
          status: 'OPEN',
          deadlineAt: null,
        }),
      },
      groupOrderInvite: { create: vi.fn().mockResolvedValue({ id: 'invite-id' }) },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new GroupOrdersService(prisma as never, {} as never, {} as never);

    const invite = await service.createInvite('host-id', 'group-id');
    expect(invite.token).toHaveLength(43);
    expect(transaction.groupOrderInvite.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        groupOrderId: 'group-id',
        createdByUserId: 'host-id',
        tokenHash: createHash('sha256').update(invite.token).digest('hex'),
        expiresAt: expect.any(Date),
      }),
      select: { id: true, expiresAt: true },
    });
  });

  it('consumes a valid invite once and rejects its replay', async () => {
    const invite = {
      id: 'invite-id',
      groupOrderId: 'group-id',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null as Date | null,
    };
    const transaction = {
      groupOrderInvite: {
        findUnique: vi.fn().mockResolvedValue(invite),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      groupOrder: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'group-id',
          status: 'OPEN',
          deadlineAt: null,
        }),
      },
      groupOrderMember: { create: vi.fn().mockResolvedValue({}) },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
      groupOrder: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'group-id',
          status: 'OPEN',
          members: [{ userId: 'participant-id' }],
          cart: { items: [] },
        }),
      },
    };
    const service = new GroupOrdersService(prisma as never, {} as never, {} as never);

    await expect(service.join('participant-id', 'a'.repeat(43))).resolves.toMatchObject({
      id: 'group-id',
    });
    expect(transaction.groupOrderInvite.updateMany).toHaveBeenCalledWith({
      where: { id: 'invite-id', consumedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { consumedAt: expect.any(Date), consumedByUserId: 'participant-id' },
    });
    expect(transaction.groupOrderMember.create).toHaveBeenCalledWith({
      data: { groupOrderId: 'group-id', userId: 'participant-id' },
    });

    invite.consumedAt = new Date();
    await expect(service.join('another-user', 'a'.repeat(43))).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(transaction.groupOrderMember.create).toHaveBeenCalledOnce();
  });

  it('hides group data from users who are neither host nor members', async () => {
    const prisma = { groupOrder: { findFirst: vi.fn().mockResolvedValue(null) } };
    const service = new GroupOrdersService(prisma as never, {} as never, {} as never);

    await expect(service.get('outsider-id', 'group-id')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.groupOrder.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'group-id',
        OR: [{ hostUserId: 'outsider-id' }, { members: { some: { userId: 'outsider-id' } } }],
      },
      include: expect.any(Object),
    });
  });

  it('locks only a non-empty group order at the host request', async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      groupOrder: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'group-id',
          hostUserId: 'host-id',
          status: 'OPEN',
          deadlineAt: null,
          cartId: 'cart-id',
          cart: { _count: { items: 2 } },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new GroupOrdersService(prisma as never, {} as never, {} as never);

    await expect(service.lock('host-id', 'group-id')).resolves.toMatchObject({
      status: 'LOCKED',
      cartId: 'cart-id',
    });
    expect(transaction.groupOrder.update).toHaveBeenCalledWith({
      where: { id: 'group-id' },
      data: { status: 'LOCKED', lockedAt: expect.any(Date) },
    });
  });

  it('creates checkout through the shared order-intent service and stores the resulting intent', async () => {
    const orderIntent = { id: 'intent-id', status: 'OPEN' };
    const prisma = {
      groupOrder: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            id: 'group-id',
            hostUserId: 'host-id',
            status: 'LOCKED',
            cartId: 'cart-id',
            orderIntentId: null,
          })
          .mockResolvedValueOnce({ orderIntentId: 'intent-id' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const intents = { create: vi.fn().mockResolvedValue(orderIntent) };
    const service = new GroupOrdersService(prisma as never, {} as never, intents as never);

    await expect(service.checkout('host-id', 'group-id')).resolves.toEqual(orderIntent);
    expect(intents.create).toHaveBeenCalledWith(
      'host-id',
      { cartId: 'cart-id' },
      'group-order-group-id-checkout',
      undefined,
    );
    expect(prisma.groupOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'group-id', hostUserId: 'host-id', status: 'LOCKED', orderIntentId: null },
      data: {
        status: 'CHECKED_OUT',
        orderIntentId: 'intent-id',
        checkedOutAt: expect.any(Date),
      },
    });
  });
});