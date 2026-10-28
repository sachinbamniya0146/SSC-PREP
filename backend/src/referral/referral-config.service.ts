import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_REFERRAL_CONFIG, REFERRAL_CONFIG_KEY, ReferralConfig, mergeReferralConfig, validateReferralConfigInput } from './referral-config';

const CACHE_MS = 20_000;

/** Reads / saves the Refer & Earn rules (stored in app_settings, edited from the admin console). */
@Injectable()
export class ReferralConfigService {
  private cache: { at: number; value: ReferralConfig } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<ReferralConfig> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    let value = { ...DEFAULT_REFERRAL_CONFIG };
    try {
      const row = await this.prisma.appSetting.findUnique({ where: { key: REFERRAL_CONFIG_KEY } });
      value = mergeReferralConfig(row?.valueJson);
    } catch {
      // table not migrated yet / DB blip: the safe defaults keep payments and signups working
    }
    this.cache = { at: Date.now(), value };
    return value;
  }

  async save(input: unknown, adminId: string): Promise<{ config: ReferralConfig; before: ReferralConfig }> {
    const checked = validateReferralConfigInput(input);
    if (!checked.ok) {
      throw new BadRequestException(checked.error);
    }
    const before = await this.get();
    await this.prisma.appSetting.upsert({
      where: { key: REFERRAL_CONFIG_KEY },
      create: { key: REFERRAL_CONFIG_KEY, valueJson: checked.config as any, updatedBy: adminId },
      update: { valueJson: checked.config as any, updatedBy: adminId },
    });
    this.cache = { at: Date.now(), value: checked.config };
    return { config: checked.config, before };
  }
}
