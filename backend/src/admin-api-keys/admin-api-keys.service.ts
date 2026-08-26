import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface ApiKeyInput {
  provider: string;
  keyName: string;
  apiKey: string;
  freeModelOnly?: boolean;
  isPrimary?: boolean;
}

@Injectable()
export class AdminApiKeyService {
  constructor(private readonly prisma: PrismaService) {}

  async getKeys(provider?: string) {
    const where: Record<string, unknown> = {};
    if (provider) where.provider = provider;

    const keys = await this.prisma.adminApiKey.findMany({
      where,
      select: {
        id: true,
        provider: true,
        keyName: true,
        apiKey: true,
        isActive: true,
        isPrimary: true,
        freeModelOnly: true,
        createdAt: true,
        createdBy: true,
      },
      orderBy: { isPrimary: 'desc' },
    });

    return keys.map((k) => ({
      ...k,
      apiKey: k.apiKey ? `${k.apiKey.substring(0, 8)}...${k.apiKey.substring(k.apiKey.length - 4)}` : '',
    }));
  }

  async addKey(dto: ApiKeyInput, _createdBy: string) {
    if (dto.isPrimary) {
      await this.prisma.adminApiKey.updateMany({
        where: { provider: dto.provider, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    return this.prisma.adminApiKey.create({
      data: {
        provider: dto.provider,
        keyName: dto.keyName,
        apiKey: dto.apiKey,
        freeModelOnly: dto.freeModelOnly || false,
        isPrimary: dto.isPrimary || false,
      },
      select: {
        id: true,
        provider: true,
        keyName: true,
        apiKey: true,
        isActive: true,
        isPrimary: true,
        freeModelOnly: true,
        createdAt: true,
      },
    });
  }

  async updateKey(id: string, dto: Partial<ApiKeyInput> & { isPrimary?: boolean; isActive?: boolean }, _createdBy: string) {
    const existing = await this.prisma.adminApiKey.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('API Key not found');

    if (dto.isPrimary) {
      await this.prisma.adminApiKey.updateMany({
        where: { provider: existing.provider, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    return this.prisma.adminApiKey.update({
      where: { id },
      data: {
        keyName: dto.keyName,
        apiKey: dto.apiKey,
        isActive: dto.isActive,
        freeModelOnly: dto.freeModelOnly,
        isPrimary: dto.isPrimary,
      },
      select: {
        id: true,
        provider: true,
        keyName: true,
        apiKey: true,
        isActive: true,
        isPrimary: true,
        freeModelOnly: true,
        createdAt: true,
      },
    });
  }

  async deleteKey(id: string) {
    const existing = await this.prisma.adminApiKey.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('API Key not found');

    await this.prisma.adminApiKey.delete({ where: { id } });
    return { ok: true };
  }

  async getActiveKey(provider: string) {
    const key = await this.prisma.adminApiKey.findFirst({
      where: { provider, isActive: true, isPrimary: true },
      select: { apiKey: true, freeModelOnly: true },
    });
    return key ? { key: key.apiKey, freeModelOnly: key.freeModelOnly } : null;
  }

  async getPrimaryKeyForProvider(provider: string) {
    const key = await this.prisma.adminApiKey.findFirst({
      where: { provider, isActive: true, isPrimary: true },
      select: { apiKey: true },
    });
    return key?.apiKey || null;
  }
}
