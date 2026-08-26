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

  /** Get all admin API keys (keys are masked in response) */
  async getKeys(provider?: string) {
    const where: any = {};
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

    // Mask the API keys in response
    return keys.map((k: any) => ({
      ...k,
      apiKey: k.apiKey ? `${k.apiKey.substring(0, 8)}...${k.apiKey.substring(k.apiKey.length - 4)}` : '',
    }));
  }

  /** Add a new API key */
  async addKey(dto: ApiKeyInput, createdBy: string) {
    // If setting as primary, clear primary flag from existing keys of same provider
    if (dto.isPrimary) {
      await this.prisma.adminApiKey.updateMany({
        where: { provider: dto.provider, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const key = await this.prisma.adminApiKey.create({
      data: {
        provider: dto.provider,
        keyName: dto.keyName,
        apiKey: dto.apiKey, // In production, encrypt this
        freeModelOnly: dto.freeModelOnly || false,
        isPrimary: dto.isPrimary || false,
        createdBy,
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

    return key;
  }

  /** Update an API key */
  async updateKey(id: string, dto: Partial<ApiKeyInput> & { isPrimary?: boolean; isActive?: boolean }, createdBy: string) {
    const existing = await this.prisma.adminApiKey.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('API Key not found');

    if (dto.isPrimary) {
      await this.prisma.adminApiKey.updateMany({
        where: { provider: existing.provider, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const key = await this.prisma.adminApiKey.update({
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

    return key;
  }

  /** Delete an API key */
  async deleteKey(id: string) {
    const existing = await this.prisma.adminApiKey.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('API Key not found');

    await this.prisma.adminApiKey.delete({ where: { id } });
    return { ok: true };
  }

  /** Get active primary key for a provider (used by AI service) */
  async getActiveKey(provider: string): Promise<{ key: string; freeModelOnly: boolean } | null> {
    const key = await this.prisma.adminApiKey.findFirst({
      where: { provider, isActive: true, isPrimary: true },
      select: { apiKey: true, freeModelOnly: true },
    });
    return key ? { key: key.apiKey, freeModelOnly: key.freeModelOnly } : null;
  }

  /** Get primary key for AI explanation service */
  async getPrimaryKeyForProvider(provider: string): Promise<string | null> {
    const key = await this.prisma.adminApiKey.findFirst({
      where: { provider, isActive: true, isPrimary: true },
      select: { apiKey: true },
    });
    return key?.apiKey || null;
  }
}
