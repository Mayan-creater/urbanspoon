import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AdminService } from './admin.service.js';

function setup() {
  const transaction = {
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: 'target-id', status: 'ACTIVE', roles: [] }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'target-id', status: 'SUSPENDED' }),
    },
    userRole: { count: vi.fn().mockResolvedValue(1) },
    authSession: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: vi.fn((operation: (client: typeof transaction) => unknown) =>
      operation(transaction),
    ),
  };
  return { transaction, service: new AdminService(prisma as never) };
}

describe('AdminService user status operations', () => {
  it('revokes active sessions and audits a reasoned suspension', async () => {
    const { transaction, service } = setup();

    await service.updateUserStatus(
      { id: 'admin-id' } as never,
      'target-id',
      'SUSPENDED',
      'Policy violation',
      'request-id',
    );

    expect(transaction.authSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'target-id', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'USER_STATUS_CHANGED',
        correlationId: 'request-id',
        after: { status: 'SUSPENDED', reason: 'Policy violation' },
      }),
    });
  });

  it('does not disable the last active super-admin', async () => {
    const { transaction, service } = setup();
    transaction.user.findUnique.mockResolvedValue({
      id: 'target-id',
      status: 'ACTIVE',
      roles: [{ id: 'role-assignment-id' }],
    });
    transaction.userRole.count.mockResolvedValue(0);

    await expect(
      service.updateUserStatus({ id: 'admin-id' } as never, 'target-id', 'DISABLED', 'Offboarding'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.userRole.count).toHaveBeenCalledWith({
      where: {
        userId: { not: 'target-id' },
        user: { status: 'ACTIVE' },
        role: 'super_admin',
        scopeType: 'PLATFORM',
        status: 'ACTIVE',
      },
    });
    expect(transaction.user.updateMany).not.toHaveBeenCalled();
  });
});
