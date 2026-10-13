import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import { PrismaService } from '../database/prisma.service.js';
import { DeliveryEvidenceStorage } from './delivery-evidence-storage.js';

export type DeliveryEvidenceType = 'IDENTITY' | 'VEHICLE' | 'PICKUP_PROOF' | 'DELIVERY_PROOF';

export interface EvidenceUpload {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const maxEvidenceBytes = 10 * 1024 * 1024;
const metadataSelect = {
  id: true,
  evidenceType: true,
  originalFilename: true,
  contentType: true,
  sizeBytes: true,
  sha256: true,
  deliveryId: true,
  createdAt: true,
} as const;

@Injectable()
export class DeliveryEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(DeliveryEvidenceStorage)
    private readonly storage = new DeliveryEvidenceStorage(),
  ) {}

  async uploadPartnerDocument(userId: string, type: 'IDENTITY' | 'VEHICLE', file: EvidenceUpload) {
    const partner = await this.prisma.deliveryPartner.findUnique({ where: { userId } });
    if (!partner) throw new NotFoundException('Delivery partner profile not found');
    if (partner.verificationStatus !== 'PENDING') {
      throw new ConflictException('Documents can only be added while verification is pending');
    }
    return this.save(partner.id, null, userId, type, file);
  }

  async listPartnerDocuments(userId: string) {
    const partner = await this.prisma.deliveryPartner.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!partner) throw new NotFoundException('Delivery partner profile not found');
    return this.prisma.deliveryEvidence.findMany({
      where: { deliveryPartnerId: partner.id, deliveryId: null },
      select: metadataSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async listPartnerEvidence(userId: string) {
    const partner = await this.prisma.deliveryPartner.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!partner) throw new NotFoundException('Delivery partner profile not found');
    return this.prisma.deliveryEvidence.findMany({
      where: { deliveryPartnerId: partner.id },
      select: metadataSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async uploadDeliveryProof(
    userId: string,
    partnerId: string,
    deliveryId: string,
    type: 'PICKUP_PROOF' | 'DELIVERY_PROOF',
    file: EvidenceUpload,
  ) {
    const partner = await this.prisma.deliveryPartner.findUnique({
      where: { id: partnerId },
      select: { id: true, userId: true },
    });
    if (!partner || partner.userId !== userId) throw new ForbiddenException();
    const delivery = await this.prisma.delivery.findFirst({
      where: {
        id: deliveryId,
        deliveryPartnerId: partnerId,
        status: {
          in:
            type === 'PICKUP_PROOF'
              ? ['PICKED_UP', 'ARRIVED', 'DELIVERED']
              : ['ARRIVED', 'DELIVERED'],
        },
      },
      select: { id: true },
    });
    if (!delivery) {
      throw new ConflictException(
        'Proof can only be attached after the corresponding delivery step',
      );
    }
    return this.save(partnerId, deliveryId, userId, type, file);
  }

  listAdminEvidence(partnerId: string) {
    return this.prisma.deliveryEvidence.findMany({
      where: { deliveryPartnerId: partnerId },
      select: metadataSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async listAdminDeliveryEvidence() {
    const evidence = await this.prisma.deliveryEvidence.findMany({
      where: { deliveryId: { not: null } },
      select: {
        ...metadataSelect,
        delivery: { select: { orderId: true } },
        deliveryPartner: { select: { user: { select: { name: true, email: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return evidence.map((item) => ({
      ...item,
      orderId: item.delivery?.orderId ?? null,
      partner: item.deliveryPartner.user,
      delivery: undefined,
      deliveryPartner: undefined,
    }));
  }

  async readPartnerEvidence(userId: string, evidenceId: string) {
    const evidence = await this.prisma.deliveryEvidence.findFirst({
      where: { id: evidenceId, deliveryPartner: { userId } },
    });
    if (!evidence) throw new NotFoundException('Delivery evidence not found');
    return {
      metadata: this.metadata(evidence),
      content: await this.storage.read(evidence.storageId),
    };
  }

  async readAdminEvidence(evidenceId: string, partnerId: string) {
    const evidence = await this.prisma.deliveryEvidence.findFirst({
      where: { id: evidenceId, deliveryPartnerId: partnerId },
    });
    if (!evidence) throw new NotFoundException('Delivery evidence not found');
    return {
      metadata: this.metadata(evidence),
      content: await this.storage.read(evidence.storageId),
    };
  }

  async readAdminDeliveryEvidence(evidenceId: string, deliveryId: string) {
    const evidence = await this.prisma.deliveryEvidence.findFirst({
      where: { id: evidenceId, deliveryId },
    });
    if (!evidence) throw new NotFoundException('Delivery evidence not found');
    return {
      metadata: this.metadata(evidence),
      content: await this.storage.read(evidence.storageId),
    };
  }

  private async save(
    partnerId: string,
    deliveryId: string | null,
    userId: string,
    type: DeliveryEvidenceType,
    file: EvidenceUpload,
  ) {
    this.validateFile(file);
    const storageId = await this.storage.store(file.buffer);
    try {
      const evidence = await this.prisma.deliveryEvidence.create({
        data: {
          storageId,
          deliveryPartnerId: partnerId,
          deliveryId,
          uploadedByUserId: userId,
          evidenceType: type,
          originalFilename: this.safeFilename(file.originalname),
          contentType: file.mimetype,
          sizeBytes: file.size,
          sha256: createHash('sha256').update(file.buffer).digest('hex'),
        },
        select: metadataSelect,
      });
      return evidence;
    } catch (error) {
      await this.storage.remove(storageId);
      throw error;
    }
  }

  private validateFile(file: EvidenceUpload) {
    if (!file?.buffer?.length || file.size !== file.buffer.length || file.size > maxEvidenceBytes) {
      throw new BadRequestException('Evidence must be a non-empty file no larger than 10 MB');
    }
    const extension = extname(file.originalname).toLowerCase();
    const signatures: Record<
      string,
      { extensions: string[]; matches: (content: Buffer) => boolean }
    > = {
      'application/pdf': {
        extensions: ['.pdf'],
        matches: (content) => content.subarray(0, 5).toString() === '%PDF-',
      },
      'image/jpeg': {
        extensions: ['.jpg', '.jpeg'],
        matches: (content) =>
          content.length > 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff,
      },
      'image/png': {
        extensions: ['.png'],
        matches: (content) =>
          content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      },
      'image/webp': {
        extensions: ['.webp'],
        matches: (content) =>
          content.subarray(0, 4).toString() === 'RIFF' &&
          content.subarray(8, 12).toString() === 'WEBP',
      },
    };
    const signature = signatures[file.mimetype];
    if (
      !signature ||
      !signature.extensions.includes(extension) ||
      !signature.matches(file.buffer)
    ) {
      throw new BadRequestException('Evidence must be a valid PDF, JPEG, PNG, or WebP file');
    }
  }

  private safeFilename(filename: string) {
    const safe = basename(filename)
      .replace(/[^A-Za-z0-9._-]/g, '_')
      .slice(0, 180);
    return safe || 'evidence';
  }

  private metadata(evidence: {
    id: string;
    evidenceType: DeliveryEvidenceType;
    originalFilename: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    deliveryId: string | null;
    createdAt: Date;
  }) {
    return {
      id: evidence.id,
      evidenceType: evidence.evidenceType,
      originalFilename: evidence.originalFilename,
      contentType: evidence.contentType,
      sizeBytes: evidence.sizeBytes,
      sha256: evidence.sha256,
      deliveryId: evidence.deliveryId,
      createdAt: evidence.createdAt,
    };
  }
}
