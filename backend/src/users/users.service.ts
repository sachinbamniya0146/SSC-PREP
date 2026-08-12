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

  async listActiveSessions(userId: string) {
    return this.prisma.deviceSession.findMany({
      where: { userId },
      orderBy: { lastActiveAt: 'desc' },
      take: 20,
    });
  }
}