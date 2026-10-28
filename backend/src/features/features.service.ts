/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FLAG_DEFS, FEATURES_KEY, FeatureState, applyFeatureInput, defaultFlags, mergeFeatureState, publicView } from './features-config';

const CACHE_MS = 15_000;

/**
 * Reads / saves the admin's feature switches (stored in app_settings, key "features.config").
 * A failed read never blocks the app: the declared defaults are used (everything on).
 */
@Injectable()
export class FeaturesService {
  private cache: { at: number; value: FeatureState } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<FeatureState> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    let value = mergeFeatureState(null);
    try {
      const row = await this.prisma.appSetting.findUnique({ where: { key: FEATURES_KEY } });
      value = mergeFeatureState(row?.valueJson);
    } catch {
      // table not migrated yet / DB blip: defaults keep the app working
    }
    this.cache = { at: Date.now(), value };
    return value;
  }

  /** Public shape for the student app. */
  async getPublic() {
    return publicView(await this.get());
  }

  async isEnabled(key: string): Promise<boolean> {
    const flags = (await this.get()).flags;
    return key in flags ? flags[key] : defaultFlags()[key] !== false;
  }

  /** Server-side enforcement: throws 503 with a friendly message when the admin switched the feature off. */
  async assertEnabled(key: string, message?: string): Promise<void> {
    if (await this.isEnabled(key)) return;
    const def = FLAG_DEFS.find((d) => d.key === key);
    throw new ServiceUnavailableException(message || `${def?.label ?? 'This feature'} is temporarily switched off. Please try again later.`);
  }

  async save(input: unknown, adminId: string): Promise<{ state: FeatureState; before: FeatureState }> {
    const before = await this.get();
    const checked = applyFeatureInput(before, input);
    if (!checked.ok) throw new BadRequestException(checked.error);
    await this.prisma.appSetting.upsert({
      where: { key: FEATURES_KEY },
      create: { key: FEATURES_KEY, valueJson: checked.state as any, updatedBy: adminId },
      update: { valueJson: checked.state as any, updatedBy: adminId },
    });
    this.cache = { at: Date.now(), value: checked.state };
    return { state: checked.state, before };
  }
}
