import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface ApiKeyInput {
  provider: string;
  keyName: string;
  apiKey: string;
  freeModelOnly?: boolean;
  isPrimary?: boolean;
}

function maskKey(apiKey: string | null | undefined): string {
  if (!apiKey) return '';
  if (apiKey.length <= 12) return `${apiKey.substring(0, 3)}...`;
  return `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`;
}

// Below this many *active* keys left for a provider, the admin gets warned;
// at 0 they get a CRITICAL alert. Kept small since most SSC-prep admins are
// running a handful of free-tier keys, not hundreds.
const LOW_KEY_WARNING_THRESHOLD = 1;
// Don't spam the admin with a fresh alert every single request once the
// pool is already low/empty — only re-raise if the last one is old enough
// (or was already resolved).
const ALERT_DEDUPE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

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
        usageCount: true,
        failureCount: true,
        lastUsedAt: true,
        lastFailureAt: true,
        lastErrorMessage: true,
        exhaustedAt: true,
        createdAt: true,
        createdBy: true,
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });

    return keys.map((k) => ({ ...k, apiKey: maskKey(k.apiKey) }));
  }

  /** Active-vs-total key counts per provider, for a dashboard health widget. */
  async getPoolHealth() {
    const keys = await this.prisma.adminApiKey.findMany({
      select: { provider: true, isActive: true },
    });
    const byProvider = new Map<string, { total: number; active: number }>();
    for (const k of keys) {
      const entry = byProvider.get(k.provider) ?? { total: 0, active: 0 };
      entry.total += 1;
      if (k.isActive) entry.active += 1;
      byProvider.set(k.provider, entry);
    }
    return Array.from(byProvider.entries()).map(([provider, counts]) => ({ provider, ...counts }));
  }

  async addKey(dto: ApiKeyInput, createdBy?: string) {
    this.validateInput(dto);
    if (dto.isPrimary) {
      await this.prisma.adminApiKey.updateMany({
        where: { provider: dto.provider, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const created = await this.prisma.adminApiKey.create({
      data: {
        provider: dto.provider,
        keyName: dto.keyName,
        apiKey: dto.apiKey.trim(),
        freeModelOnly: dto.freeModelOnly ?? true,
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
    // BUGFIX: getKeys() masks apiKey before returning it, but this response
    // (and updateKey()'s below) returned the full plaintext key — an
    // inconsistent leak of the very secret the list endpoint deliberately
    // hides. Masked the same way here.
    return { ...created, apiKey: maskKey(created.apiKey) };
  }

  /**
   * Bulk-add many keys for one provider in a single call — e.g. pasting a
   * list of free OpenRouter keys collected from several accounts. Keys
   * already present for that provider are skipped (not duplicated) so this
   * is safe to re-run with an updated/overlapping list.
   */
  async bulkAddKeys(
    input: { provider: string; freeModelOnly?: boolean; keys: { apiKey: string; keyName?: string }[] },
    createdBy?: string,
  ) {
    if (!input.provider?.trim()) throw new BadRequestException('provider is required');
    const cleaned = (input.keys ?? [])
      .map((k) => ({ apiKey: (k.apiKey || '').trim(), keyName: k.keyName?.trim() }))
      .filter((k) => k.apiKey.length > 0);
    if (cleaned.length === 0) throw new BadRequestException('No API keys provided');

    const existing = await this.prisma.adminApiKey.findMany({
      where: { provider: input.provider },
      select: { apiKey: true },
    });
    const existingSet = new Set(existing.map((e) => e.apiKey));

    // De-dupe within the pasted batch itself too.
    const seenInBatch = new Set<string>();
    const toCreate: { provider: string; keyName: string; apiKey: string; freeModelOnly: boolean; createdBy?: string }[] = [];
    let skippedDuplicate = 0;

    cleaned.forEach((k, i) => {
      if (existingSet.has(k.apiKey) || seenInBatch.has(k.apiKey)) {
        skippedDuplicate++;
        return;
      }
      seenInBatch.add(k.apiKey);
      toCreate.push({
        provider: input.provider,
        keyName: k.keyName || `${input.provider} bulk key #${i + 1}`,
        apiKey: k.apiKey,
        freeModelOnly: input.freeModelOnly ?? true,
        createdBy,
      });
    });

    if (toCreate.length > 0) {
      await this.prisma.adminApiKey.createMany({ data: toCreate });

      // If this provider had zero primary key before, make the first
      // newly-added one primary so rotation has somewhere to start.
      const hasPrimary = await this.prisma.adminApiKey.findFirst({
        where: { provider: input.provider, isPrimary: true },
        select: { id: true },
      });
      if (!hasPrimary) {
        const firstNew = await this.prisma.adminApiKey.findFirst({
          where: { provider: input.provider, apiKey: toCreate[0].apiKey },
          select: { id: true },
        });
        if (firstNew) {
          await this.prisma.adminApiKey.update({ where: { id: firstNew.id }, data: { isPrimary: true } });
        }
      }

      // Adding keys can resolve an existing low/empty-pool alert.
      await this.autoResolveLowKeyAlerts(input.provider);
    }

    return {
      requested: cleaned.length,
      added: toCreate.length,
      skippedDuplicate,
      provider: input.provider,
    };
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

    // Re-activating a key (e.g. admin topped up quota) should clear its
    // exhausted markers so rotation picks it up again immediately.
    const reactivating = dto.isActive === true && !existing.isActive;

    const updated = await this.prisma.adminApiKey.update({
      where: { id },
      data: {
        keyName: dto.keyName,
        apiKey: dto.apiKey,
        isActive: dto.isActive,
        freeModelOnly: dto.freeModelOnly,
        isPrimary: dto.isPrimary,
        ...(reactivating ? { exhaustedAt: null, failureCount: 0, lastErrorMessage: null } : {}),
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
    if (reactivating) await this.autoResolveLowKeyAlerts(existing.provider);
    return { ...updated, apiKey: maskKey(updated.apiKey) };
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

  /**
   * The rotation pool for a provider: every active key, primary first, then
   * least-recently-used first, so load spreads across the whole pool
   * instead of hammering one key until it dies. Callers should try these
   * in order and call reportUsage() after each attempt.
   */
  async getRotationPool(provider: string) {
    return this.prisma.adminApiKey.findMany({
      where: { provider, isActive: true },
      orderBy: [{ isPrimary: 'desc' }, { lastUsedAt: 'asc' }],
      select: { id: true, apiKey: true, keyName: true, freeModelOnly: true },
    });
  }

  /**
   * Record the outcome of actually using a key. `exhausted: true` means the
   * error looked like "this key is out of quota / invalid / revoked" (not a
   * transient network blip) — the key is auto-deactivated so rotation skips
   * it next time, and the admin is alerted if the pool is now low/empty.
   */
  async reportUsage(id: string, success: boolean, opts?: { exhausted?: boolean; errorMessage?: string }) {
    if (success) {
      await this.prisma.adminApiKey.update({
        where: { id },
        data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
      });
      return;
    }

    const key = await this.prisma.adminApiKey.update({
      where: { id },
      data: {
        failureCount: { increment: 1 },
        lastFailureAt: new Date(),
        lastErrorMessage: opts?.errorMessage?.slice(0, 500),
        lastUsedAt: new Date(),
        ...(opts?.exhausted ? { isActive: false, exhaustedAt: new Date() } : {}),
      },
      select: { provider: true },
    });

    if (opts?.exhausted) {
      await this.checkLowKeyAndAlert(key.provider, opts.errorMessage);
    }
  }

  /** Counts remaining active keys for a provider and raises an alert if low/zero. */
  private async checkLowKeyAndAlert(provider: string, lastError?: string) {
    const activeCount = await this.prisma.adminApiKey.count({ where: { provider, isActive: true } });

    if (activeCount > LOW_KEY_WARNING_THRESHOLD) return; // pool is healthy

    const type = activeCount === 0 ? 'API_KEY_ALL_EXHAUSTED' : 'API_KEY_LOW';
    const severity = activeCount === 0 ? 'CRITICAL' : 'WARNING';

    // Avoid spamming: skip if an unresolved alert of the same type for this
    // provider was already raised recently.
    const recent = await this.prisma.adminAlert.findFirst({
      where: {
        type,
        isResolved: false,
        createdAt: { gte: new Date(Date.now() - ALERT_DEDUPE_WINDOW_MS) },
        metadataJson: { path: ['provider'], equals: provider },
      },
    });
    if (recent) return;

    const message =
      activeCount === 0
        ? `All "${provider}" API keys are exhausted/inactive. AI features (explanations, study plan) will stop working until a new key is added.`
        : `Only ${activeCount} active "${provider}" API key left. Add another one now — AI features will stop once this one runs out too.`;
    const messageHindi =
      activeCount === 0
        ? `"${provider}" ki sabhi API keys khatam/inactive ho chuki hain. Jab tak nayi key add nahi hogi, AI features (solutions, study plan) kaam nahi karenge.`
        : `"${provider}" ki sirf ${activeCount} active API key bachi hai. Abhi ek aur add karein — ye khatam hote hi AI features ruk jayenge.`;

    await this.prisma.adminAlert.create({
      data: {
        type,
        severity,
        message,
        messageHindi,
        metadataJson: { provider, activeCount, lastError: lastError?.slice(0, 300) },
      },
    });
  }

  /** Called when keys are added/reactivated — clears stale "low pool" alerts for that provider. */
  private async autoResolveLowKeyAlerts(provider: string) {
    const activeCount = await this.prisma.adminApiKey.count({ where: { provider, isActive: true } });
    if (activeCount <= LOW_KEY_WARNING_THRESHOLD) return;
    await this.prisma.adminAlert.updateMany({
      where: {
        type: { in: ['API_KEY_LOW', 'API_KEY_ALL_EXHAUSTED'] },
        isResolved: false,
        metadataJson: { path: ['provider'], equals: provider },
      },
      data: { isResolved: true, resolvedAt: new Date() },
    });
  }

  async getAlerts(includeResolved = false) {
    return this.prisma.adminAlert.findMany({
      where: includeResolved ? {} : { isResolved: false },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async resolveAlert(id: string) {
    const existing = await this.prisma.adminAlert.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Alert not found');
    return this.prisma.adminAlert.update({
      where: { id },
      data: { isResolved: true, resolvedAt: new Date() },
    });
  }

  private validateInput(dto: ApiKeyInput) {
    if (!dto.provider?.trim()) throw new BadRequestException('provider is required');
    if (!dto.apiKey?.trim()) throw new BadRequestException('apiKey is required');
    if (!dto.keyName?.trim()) throw new BadRequestException('keyName is required');
  }
}
