import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import type {
  AgentSupportMessageDto,
  CreateSupportCaseDto,
  CustomerSupportMessageDto,
  ResolveSupportCaseDto,
} from './support.dto.js';

const customerCaseInclude = {
  order: { select: { id: true, status: true, totalMinor: true, currency: true, createdAt: true } },
  messages: {
    where: { isInternal: false },
    include: { author: { select: { name: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.SupportCaseInclude;

const agentCaseInclude = {
  ...customerCaseInclude,
  user: { select: { id: true, name: true, email: true } },
  messages: {
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.SupportCaseInclude;

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  async createCase(userId: string, input: CreateSupportCaseDto, idempotencyKey?: string) {
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      throw new BadRequestException('A 16-128 character Idempotency-Key header is required');
    }
    const existing = await this.prisma.supportCase.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      include: customerCaseInclude,
    });
    if (existing) return existing;

    const requiresOrder = ['ORDER', 'PAYMENT', 'DELIVERY'].includes(input.category);
    if (requiresOrder && !input.orderId) {
      throw new BadRequestException(`${input.category.toLowerCase()} cases require an order`);
    }
    if (!requiresOrder && input.orderId) {
      throw new BadRequestException('Account and general cases cannot be linked to an order');
    }
    if (input.orderId) {
      const order = await this.prisma.order.findFirst({
        where: { id: input.orderId, userId },
        select: { id: true },
      });
      if (!order) throw new NotFoundException('Order not found');
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const supportCase = await transaction.supportCase.create({
          data: {
            userId,
            orderId: input.orderId,
            idempotencyKey,
            category: input.category,
            priority: input.priority ?? 'NORMAL',
            subject: input.subject.trim(),
            messages: {
              create: { authorUserId: userId, body: input.message.trim(), isInternal: false },
            },
          },
          include: customerCaseInclude,
        });
        await transaction.auditLog.create({
          data: {
            actorUserId: userId,
            permission: 'support.cases.self.manage',
            action: 'SUPPORT_CASE_CREATED',
            entityType: 'support_case',
            entityId: supportCase.id,
            after: {
              category: input.category,
              priority: supportCase.priority,
              orderId: supportCase.orderId,
            },
          },
        });
        return supportCase;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await this.prisma.supportCase.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey } },
          include: customerCaseInclude,
        });
        if (duplicate) return duplicate;
      }
      throw error;
    }
  }

  listCustomerCases(userId: string) {
    return this.prisma.supportCase.findMany({
      where: { userId },
      include: customerCaseInclude,
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

  async getCustomerCase(userId: string, caseId: string) {
    const supportCase = await this.prisma.supportCase.findFirst({
      where: { id: caseId, userId },
      include: customerCaseInclude,
    });
    if (!supportCase) throw new NotFoundException('Support case not found');
    return supportCase;
  }

  async addCustomerMessage(userId: string, caseId: string, input: CustomerSupportMessageDto) {
    return this.prisma.$transaction(async (transaction) => {
      const supportCase = await transaction.supportCase.findFirst({
        where: { id: caseId, userId },
        select: { id: true, status: true },
      });
      if (!supportCase) throw new NotFoundException('Support case not found');
      if (['RESOLVED', 'CLOSED'].includes(supportCase.status)) {
        throw new ConflictException('Resolved support cases cannot receive new messages');
      }
      await transaction.supportMessage.create({
        data: { caseId, authorUserId: userId, body: input.body.trim() },
      });
      await transaction.supportCase.update({
        where: { id: caseId },
        data: { status: 'OPEN' },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: userId,
          permission: 'support.cases.self.manage',
          action: 'SUPPORT_CASE_CUSTOMER_REPLIED',
          entityType: 'support_case',
          entityId: caseId,
        },
      });
      return transaction.supportCase.findUniqueOrThrow({
        where: { id: caseId },
        include: customerCaseInclude,
      });
    });
  }

  listAgentQueue(userId: string) {
    return this.prisma.supportCase.findMany({
      where: {
        OR: [{ assignedToUserId: userId }, { assignedToUserId: null, status: 'OPEN' }],
      },
      select: {
        id: true,
        category: true,
        priority: true,
        status: true,
        subject: true,
        assignedToUserId: true,
        createdAt: true,
        updatedAt: true,
        orderId: true,
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 100,
    });
  }

  async claimCase(userId: string, caseId: string) {
    const existing = await this.prisma.supportCase.findUnique({
      where: { id: caseId },
      select: { id: true, assignedToUserId: true, status: true },
    });
    if (!existing) throw new NotFoundException('Support case not found');
    if (existing.assignedToUserId === userId) return this.getAssignedCase(userId, caseId);
    const claimed = await this.prisma.supportCase.updateMany({
      where: { id: caseId, assignedToUserId: null, status: 'OPEN' },
      data: { assignedToUserId: userId, status: 'IN_PROGRESS' },
    });
    if (!claimed.count) throw new ConflictException('Case was claimed or is no longer open');
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        permission: 'support.cases.manage',
        action: 'SUPPORT_CASE_CLAIMED',
        entityType: 'support_case',
        entityId: caseId,
      },
    });
    return this.getAssignedCase(userId, caseId);
  }

  async getAssignedCase(userId: string, caseId: string) {
    const supportCase = await this.prisma.supportCase.findFirst({
      where: { id: caseId, assignedToUserId: userId },
      include: agentCaseInclude,
    });
    if (!supportCase) throw new NotFoundException('Assigned support case not found');
    return supportCase;
  }

  async addAgentMessage(userId: string, caseId: string, input: AgentSupportMessageDto) {
    return this.prisma.$transaction(async (transaction) => {
      const supportCase = await transaction.supportCase.findFirst({
        where: { id: caseId, assignedToUserId: userId },
        select: { id: true, status: true },
      });
      if (!supportCase) throw new NotFoundException('Assigned support case not found');
      if (['RESOLVED', 'CLOSED'].includes(supportCase.status)) {
        throw new ConflictException('Resolved support cases cannot receive new messages');
      }
      const isInternal = input.isInternal ?? false;
      const message = await transaction.supportMessage.create({
        data: { caseId, authorUserId: userId, body: input.body.trim(), isInternal },
      });
      await transaction.supportCase.update({
        where: { id: caseId },
        data: { status: isInternal ? 'IN_PROGRESS' : 'WAITING_CUSTOMER' },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: userId,
          permission: 'support.cases.manage',
          action: isInternal ? 'SUPPORT_CASE_INTERNAL_NOTE' : 'SUPPORT_CASE_AGENT_REPLIED',
          entityType: 'support_case',
          entityId: caseId,
          after: { messageId: message.id, isInternal },
        },
      });
      return transaction.supportCase.findUniqueOrThrow({
        where: { id: caseId },
        include: agentCaseInclude,
      });
    });
  }

  async resolveCase(userId: string, caseId: string, input: ResolveSupportCaseDto) {
    return this.prisma.$transaction(async (transaction) => {
      const supportCase = await transaction.supportCase.findFirst({
        where: { id: caseId, assignedToUserId: userId },
        select: { id: true, status: true },
      });
      if (!supportCase) throw new NotFoundException('Assigned support case not found');
      if (['RESOLVED', 'CLOSED'].includes(supportCase.status)) {
        throw new ConflictException('Support case is already resolved');
      }
      const updated = await transaction.supportCase.updateMany({
        where: { id: caseId, assignedToUserId: userId, status: supportCase.status },
        data: {
          status: 'RESOLVED',
          resolutionSummary: input.resolutionSummary.trim(),
          customerOutcome: input.customerOutcome.trim(),
          resolvedAt: new Date(),
        },
      });
      if (!updated.count) throw new ConflictException('Support case changed; retry');
      await transaction.supportMessage.create({
        data: { caseId, authorUserId: userId, body: input.customerOutcome.trim() },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: userId,
          permission: 'support.cases.manage',
          action: 'SUPPORT_CASE_RESOLVED',
          entityType: 'support_case',
          entityId: caseId,
          after: { status: 'RESOLVED' },
        },
      });
      return transaction.supportCase.findUniqueOrThrow({
        where: { id: caseId },
        include: agentCaseInclude,
      });
    });
  }
}
