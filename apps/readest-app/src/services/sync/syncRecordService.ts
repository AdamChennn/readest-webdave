import { EnvConfigType } from '@/services/environment';
import { SYNC_RECORD_FILENAME } from '@/services/constants';
import { SyncRecordItem, SyncRecordKey, SyncRecordMap, toSyncRecordKey } from '@/types/sync';

const DEBOUNCE_DELAY_MS = 1000;

export class SyncRecordService {
  private static loaded = false;
  private static records: SyncRecordMap = {};
  private static pendingRecords: SyncRecordMap = {};
  private static flushTimer: ReturnType<typeof setTimeout> | null = null;
  private static lastEnvConfig: EnvConfigType | null = null;

  private static async loadRecords(envConfig: EnvConfigType): Promise<SyncRecordMap> {
    try {
      const appService = await envConfig.getAppService();
      const content = await appService.readFile(SYNC_RECORD_FILENAME, 'Settings', 'text');
      if (!content || typeof content !== 'string') return {};
      const parsed = JSON.parse(content) as SyncRecordMap;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private static async saveRecords(envConfig: EnvConfigType, records: SyncRecordMap) {
    const appService = await envConfig.getAppService();
    await appService.writeFile(SYNC_RECORD_FILENAME, 'Settings', JSON.stringify(records));
  }

  private static async ensureLoaded(envConfig: EnvConfigType) {
    this.lastEnvConfig = envConfig;
    if (this.loaded) return;
    this.records = await this.loadRecords(envConfig);
    this.loaded = true;
  }

  static async getAllSyncRecords(envConfig: EnvConfigType): Promise<SyncRecordMap> {
    await this.ensureLoaded(envConfig);
    const diskRecords = await this.loadRecords(envConfig);
    const merged: SyncRecordMap = {};
    const keys = new Set([
      ...Object.keys(diskRecords),
      ...Object.keys(this.records),
      ...Object.keys(this.pendingRecords),
    ]);
    for (const key of keys) {
      const disk = diskRecords[key];
      const mem = this.records[key];
      const pending = this.pendingRecords[key];
      let latest = disk;
      if (!latest || (mem && mem.time > latest.time)) latest = mem;
      if (!latest || (pending && pending.time > latest.time)) latest = pending;
      if (latest) merged[key] = latest;
    }
    this.records = merged;
    return merged;
  }

  static async flushSyncRecords() {
    if (!this.lastEnvConfig || Object.keys(this.pendingRecords).length === 0) return;
    await this.ensureLoaded(this.lastEnvConfig);
    Object.assign(this.records, this.pendingRecords);
    this.pendingRecords = {};
    await this.saveRecords(this.lastEnvConfig, this.records);
  }

  static async setAllSyncRecords(envConfig: EnvConfigType, records: SyncRecordMap) {
    this.lastEnvConfig = envConfig;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingRecords = {};
    this.records = records;
    this.loaded = true;
    await this.saveRecords(envConfig, records);
  }

  static async setSyncRecord(envConfig: EnvConfigType, key: SyncRecordKey, value: SyncRecordItem) {
    await this.ensureLoaded(envConfig);
    this.pendingRecords[toSyncRecordKey(key)] = value;

    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushSyncRecords().catch((error) => {
        console.error('Failed to flush sync records:', error);
      });
      this.flushTimer = null;
    }, DEBOUNCE_DELAY_MS);
  }
}
