import { Injectable, NotFoundException } from '@nestjs/common';
import type { UpdateProfileDto } from '../auth/auth.dto.js';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true,
        roles: {
          where: { status: 'ACTIVE' },
          select: { role: true, scopeType: true, scopeId: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!user) throw new NotFoundException();
    return user;
  }

  async updateProfile(userId: string, input: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { ...(input.name ? { name: input.name.trim() } : {}) },
      select: { id: true, name: true, email: true, phone: true, status: true },
    });
  }
}
