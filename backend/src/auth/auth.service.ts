import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev-access-secret';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret';
const ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  async signup(email: string, password: string, fullName: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.prisma.user.create({
      data: { email, fullName, passwordHash },
      select: { id: true, email: true, fullName: true, role: true },
    });
    return { user, ...this.issueTokens(user.id) };
  }

  async login(email: string, password: string, platform: 'WEB' | 'APP') {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    // Session single-device enforcement: revoke previous active session for platform.
    await this.prisma.deviceSession.updateMany({
      where: { userId: user.id, platform, isActive: true },
      data: { isActive: false },
    });
    const session = await this.prisma.deviceSession.create({
      data: { userId: user.id, platform, deviceId: `dev-${Date.now()}` },
    });
    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
      ...this.issueTokens(user.id),
      sessionId: session.id,
    };
  }

  private issueTokens(userId: string) {
    const accessSecret = ACCESS_SECRET as jwt.Secret;
    const refreshSecret = REFRESH_SECRET as jwt.Secret;
    const accessExpiry = ACCESS_EXPIRY as jwt.SignOptions["expiresIn"];
    const refreshExpiry = REFRESH_EXPIRY as jwt.SignOptions["expiresIn"];

    const accessToken = jwt.sign({ sub: userId, type: "access" }, accessSecret, {
      expiresIn: accessExpiry,
    });
    const refreshToken = jwt.sign(
      { sub: userId, type: "refresh" },
      refreshSecret,
      { expiresIn: refreshExpiry },
    );
    return {
      accessToken: accessToken as string,
      refreshToken: refreshToken as string,
    };
  }
}