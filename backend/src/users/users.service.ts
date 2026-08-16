import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        phone: true,
        isEmailVerified: true,
        currentStreak: true,
        longestStreak: true,
        xp: true,
        coins: true,
        hintQuota: true,
        createdAt: true,
      },
    });
  }

  async updatePhone(userId: string, phone: string) {
    const normalizedPhone = phone.trim();
    if (normalizedPhone.length < 10) {
      throw new Error('Mobile number must be at least 10 digits');
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: { phone: normalizedPhone },
      select: { id: true, phone: true },
    });
  }

  async listActiveSessions(userId: string) {
    return this.prisma.deviceSession.findMany({
      where: { userId },
      orderBy: { lastActiveAt: 'desc' },
      take: 20,
    });
  }
}