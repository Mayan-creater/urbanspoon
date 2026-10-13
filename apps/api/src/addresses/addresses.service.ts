import { Injectable, NotFoundException } from '@nestjs/common';
import type { CreateAddressDto, UpdateAddressDto } from './address.dto.js';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.userAddress.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async create(userId: string, input: CreateAddressDto) {
    return this.prisma.$transaction(async (transaction) => {
      const existingCount = await transaction.userAddress.count({ where: { userId } });
      const isDefault = input.isDefault ?? existingCount === 0;
      if (isDefault) {
        await transaction.userAddress.updateMany({ where: { userId }, data: { isDefault: false } });
      }
      return transaction.userAddress.create({
        data: { ...input, userId, isDefault, country: input.country ?? 'IN' },
      });
    });
  }

  async update(userId: string, id: string, input: UpdateAddressDto) {
    return this.prisma.$transaction(async (transaction) => {
      const address = await transaction.userAddress.findFirst({ where: { id, userId } });
      if (!address) throw new NotFoundException('Address not found');
      if (input.isDefault) {
        await transaction.userAddress.updateMany({ where: { userId }, data: { isDefault: false } });
      }
      return transaction.userAddress.update({
        where: { id },
        data: {
          ...input,
          ...(input.label ? { label: input.label.trim() } : {}),
          ...(input.line1 ? { line1: input.line1.trim() } : {}),
        },
      });
    });
  }

  async remove(userId: string, id: string): Promise<{ deleted: true }> {
    return this.prisma.$transaction(async (transaction) => {
      const address = await transaction.userAddress.findFirst({ where: { id, userId } });
      if (!address) throw new NotFoundException('Address not found');

      await transaction.userAddress.delete({ where: { id } });
      if (address.isDefault) {
        const nextDefault = await transaction.userAddress.findFirst({
          where: { userId },
          orderBy: { createdAt: 'asc' },
        });
        if (nextDefault) {
          await transaction.userAddress.update({
            where: { id: nextDefault.id },
            data: { isDefault: true },
          });
        }
      }
      return { deleted: true };
    });
  }
}
