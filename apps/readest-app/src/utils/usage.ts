const usageStore = new Map<string, number>();

export class UsageStatsManager {
  static async trackUsage(
    userId: string,
    usageType: string,
    increment: number = 1,
    _metadata: Record<string, string | number> = {},
  ): Promise<number> {
    const key = `${userId}:${usageType}:daily`;
    const current = usageStore.get(key) || 0;
    const next = current + increment;
    usageStore.set(key, next);
    return next;
  }

  static async getCurrentUsage(
    userId: string,
    usageType: string,
    _period: 'daily' | 'monthly' = 'daily',
  ): Promise<number> {
    const key = `${userId}:${usageType}:daily`;
    return usageStore.get(key) || 0;
  }
}
