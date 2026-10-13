import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DeliveryEvidenceService } from './delivery-evidence.service.js';

describe('DeliveryEvidenceService', () => {
  it('rejects a spoofed file type before storage', async () => {
    const storage = { store: vi.fn(), remove: vi.fn() };
    const prisma = {
      deliveryPartner: {
        findUnique: vi.fn().mockResolvedValue({ id: 'partner', verificationStatus: 'PENDING' }),
      },
    };
    const service = new DeliveryEvidenceService(prisma as never, storage as never);

    await expect(
      service.uploadPartnerDocument('user', 'IDENTITY', {
        originalname: 'identity.pdf',
        mimetype: 'application/pdf',
        size: 5,
        buffer: Buffer.from('nope!'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.store).not.toHaveBeenCalled();
  });

  it('prevents uploads for another partner and for a delivery before its proof step', async () => {
    const prisma = {
      deliveryPartner: {
        findUnique: vi.fn().mockResolvedValue({ id: 'partner', userId: 'owner' }),
      },
      delivery: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new DeliveryEvidenceService(prisma as never, {} as never);
    const file = {
      originalname: 'proof.png',
      mimetype: 'image/png',
      size: 8,
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    };

    await expect(
      service.uploadDeliveryProof('intruder', 'partner', 'delivery', 'PICKUP_PROOF', file),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.uploadDeliveryProof('owner', 'partner', 'delivery', 'PICKUP_PROOF', file),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
