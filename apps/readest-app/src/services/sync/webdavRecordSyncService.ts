import { EnvConfigType } from '@/services/environment';
import { SyncRecordItem, SyncRecordMap } from '@/types/sync';
import { SyncRecordService } from './syncRecordService';
import SyncConfigService from './syncConfigService';
import SyncService from './syncService';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';

type SyncDirection = 'push' | 'pull';

type ParsedSyncKey = {
  type: string;
  catergory: string;
  name: string;
  key: string;
};

type SyncPlan = {
  pushSettings: boolean;
  pullSettings: boolean;
  pushLibrary: boolean;
  pullLibrary: boolean;
  pushBookFiles: Set<string>;
  pullBookFiles: Set<string>;
  pushBookConfigs: Set<string>;
  pullBookConfigs: Set<string>;
  deleteBookFilesLocal: Set<string>;
  deleteBookFilesRemote: Set<string>;
  deleteBookConfigsLocal: Set<string>;
  deleteBookConfigsRemote: Set<string>;
};

const emptyPlan = (): SyncPlan => ({
  pushSettings: false,
  pullSettings: false,
  pushLibrary: false,
  pullLibrary: false,
  pushBookFiles: new Set<string>(),
  pullBookFiles: new Set<string>(),
  pushBookConfigs: new Set<string>(),
  pullBookConfigs: new Set<string>(),
  deleteBookFilesLocal: new Set<string>(),
  deleteBookFilesRemote: new Set<string>(),
  deleteBookConfigsLocal: new Set<string>(),
  deleteBookConfigsRemote: new Set<string>(),
});

const parseSyncKey = (rawKey: string): ParsedSyncKey | null => {
  const parts = rawKey.split('.');
  if (parts.length < 4) return null;
  const [type, catergory, name, ...rest] = parts;
  if (!type || !catergory || !name || !rest.length) return null;
  return { type, catergory, name, key: rest.join('.') };
};

const isSettingsRecord = (parsed: ParsedSyncKey) =>
  parsed.type === 'config' && parsed.catergory === 'readerConfig' && parsed.name === 'settings';

const isLibraryRecord = (parsed: ParsedSyncKey) =>
  parsed.type === 'database' && parsed.catergory === 'sqlite' && parsed.name === 'books';

const isBookConfigRecord = (parsed: ParsedSyncKey) =>
  parsed.type === 'config' && parsed.catergory === 'objectConfig' && parsed.name === 'bookConfig';

const mergeRecordMaps = (local: SyncRecordMap, remote: SyncRecordMap): SyncRecordMap => {
  const merged: SyncRecordMap = {};
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  for (const key of keys) {
    const l = local[key];
    const r = remote[key];
    if (!l) {
      merged[key] = r!;
      continue;
    }
    if (!r) {
      merged[key] = l;
      continue;
    }
    merged[key] = l.time >= r.time ? l : r;
  }
  return merged;
};

const parseSyncRecordContent = (raw: string): SyncRecordMap => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as SyncRecordMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

export class WebDAVRecordSyncService {
  private static async ensureLocalSyncRecords(
    envConfig: EnvConfigType,
    forceRebuild = false,
  ): Promise<SyncRecordMap> {
    await SyncRecordService.flushSyncRecords();
    let localRecords = forceRebuild ? {} : await SyncRecordService.getAllSyncRecords(envConfig);
    if (Object.keys(localRecords).length > 0) return localRecords;

    const now = Date.now();
    const appService = await envConfig.getAppService();
    const settings = await appService.loadSettings();
    const books = await appService.loadLibraryBooks();
    const generated: SyncRecordMap = {};

    generated['config.readerConfig.settings.all'] = { operation: 'update', time: now };
    for (const book of books) {
      generated[`database.sqlite.books.${book.hash}`] = {
        operation: book.deletedAt ? 'delete' : 'save',
        time: book.updatedAt || now,
      };
      const configPath = `${book.hash}/config.json`;
      if (await appService.exists(configPath, 'Books')) {
        generated[`config.objectConfig.bookConfig.${book.hash}`] = {
          operation: 'update',
          time: book.updatedAt || now,
        };
      }
    }
    generated['config.readerConfig.settings.syncMode'] = {
      operation: 'update',
      time: now,
    };
    generated['config.readerConfig.settings.webdav'] = {
      operation: 'update',
      time: now,
    };
    if (settings.lastSyncedAtBooks) {
      generated['config.readerConfig.settings.lastSyncedAtBooks'] = {
        operation: 'update',
        time: settings.lastSyncedAtBooks,
      };
    }

    await SyncRecordService.setAllSyncRecords(envConfig, generated);
    localRecords = generated;
    return localRecords;
  }

  private static collectPlan(
    localRecords: SyncRecordMap,
    remoteRecords: SyncRecordMap,
    direction: SyncDirection | 'both',
  ): SyncPlan {
    const plan = emptyPlan();
    const allKeys = new Set([...Object.keys(localRecords), ...Object.keys(remoteRecords)]);

    const applyDirection = (
      parsed: ParsedSyncKey,
      record: SyncRecordItem,
      targetDirection: SyncDirection,
    ) => {
      if (targetDirection === 'push') {
        if (isSettingsRecord(parsed)) plan.pushSettings = true;
        if (isLibraryRecord(parsed)) {
          plan.pushLibrary = true;
          if (parsed.key !== '__all__') {
            if (record.operation === 'delete') {
              plan.deleteBookFilesRemote.add(parsed.key);
            } else if (record.operation === 'save') {
              plan.pushBookFiles.add(parsed.key);
            }
          }
        }
        if (isBookConfigRecord(parsed)) {
          if (record.operation === 'delete') {
            plan.deleteBookConfigsRemote.add(parsed.key);
          } else {
            plan.pushBookConfigs.add(parsed.key);
          }
        }
      } else {
        if (isSettingsRecord(parsed)) plan.pullSettings = true;
        if (isLibraryRecord(parsed)) {
          plan.pullLibrary = true;
          if (parsed.key !== '__all__') {
            if (record.operation === 'delete') {
              plan.deleteBookFilesLocal.add(parsed.key);
            } else if (record.operation === 'save') {
              plan.pullBookFiles.add(parsed.key);
            }
          }
        }
        if (isBookConfigRecord(parsed)) {
          if (record.operation === 'delete') {
            plan.deleteBookConfigsLocal.add(parsed.key);
          } else {
            plan.pullBookConfigs.add(parsed.key);
          }
        }
      }
    };

    for (const key of allKeys) {
      const local = localRecords[key];
      const remote = remoteRecords[key];
      const parsed = parseSyncKey(key);
      if (!parsed) continue;

      if (direction === 'push') {
        if (local) applyDirection(parsed, local, 'push');
        continue;
      }

      if (direction === 'pull') {
        if (remote) applyDirection(parsed, remote, 'pull');
        continue;
      }

      if (local && !remote) {
        applyDirection(parsed, local, 'push');
        continue;
      }
      if (!local && remote) {
        applyDirection(parsed, remote, 'pull');
        continue;
      }
      if (!local || !remote) continue;
      if (local.time > remote.time) {
        applyDirection(parsed, local, 'push');
      } else if (remote.time > local.time) {
        applyDirection(parsed, remote, 'pull');
      }
    }

    return plan;
  }

  private static async applyPlan(envConfig: EnvConfigType, plan: SyncPlan): Promise<void> {
    if (plan.pushSettings) {
      await SyncConfigService.uploadSettings(envConfig);
    }
    if (plan.pushLibrary) {
      await SyncConfigService.uploadLibrary(envConfig);
    }
    for (const hash of plan.pushBookFiles) {
      await SyncConfigService.uploadBookAssets(envConfig, hash);
    }
    for (const hash of plan.pushBookConfigs) {
      await SyncConfigService.uploadBookConfig(envConfig, hash);
    }
    for (const hash of plan.deleteBookFilesRemote) {
      await SyncConfigService.deleteBookAssetsRemote(envConfig, hash);
    }
    for (const hash of plan.deleteBookConfigsRemote) {
      await SyncConfigService.deleteBookConfig(envConfig, hash);
    }

    if (plan.pullSettings) {
      await SyncConfigService.downloadSettings(envConfig);
      const appService = await envConfig.getAppService();
      const loadedSettings = await appService.loadSettings();
      useSettingsStore.getState().setSettings(loadedSettings);
    }
    if (plan.pullLibrary) {
      await SyncConfigService.downloadLibrary(envConfig);
      const appService = await envConfig.getAppService();
      const books = await appService.loadLibraryBooks();
      useLibraryStore.getState().setLibrary(books);
    }
    for (const hash of plan.pullBookFiles) {
      await SyncConfigService.downloadBookAssets(envConfig, hash);
    }
    for (const hash of plan.pullBookConfigs) {
      await SyncConfigService.downloadBookConfig(envConfig, hash);
    }
    for (const hash of plan.deleteBookFilesLocal) {
      await SyncConfigService.deleteBookAssetsLocal(envConfig, hash);
    }
    for (const hash of plan.deleteBookConfigsLocal) {
      const appService = await envConfig.getAppService();
      const localPath = `${hash}/config.json`;
      if (await appService.exists(localPath, 'Books')) {
        await appService.deleteFile(localPath, 'Books');
      }
    }
  }

  static async sync(envConfig: EnvConfigType, direction: SyncDirection | 'both' = 'both') {
    const util = await SyncService.getSyncUtil(envConfig);
    if (!util) {
      return { ok: false, reason: 'disabled' as const };
    }

    const localRecords = await this.ensureLocalSyncRecords(envConfig);
    const remoteSyncRaw = await SyncConfigService.downloadSyncRecord(envConfig);
    const remoteRecords = parseSyncRecordContent(remoteSyncRaw);

    const plan = this.collectPlan(localRecords, remoteRecords, direction);
    await this.applyPlan(envConfig, plan);

    const merged = mergeRecordMaps(localRecords, remoteRecords);
    await SyncRecordService.setAllSyncRecords(envConfig, merged);
    await util.uploadFile('sync.json', 'config', JSON.stringify(merged));

    return {
      ok: true,
      plan: {
        pushSettings: plan.pushSettings,
        pullSettings: plan.pullSettings,
        pushLibrary: plan.pushLibrary,
        pullLibrary: plan.pullLibrary,
        pushBookFiles: plan.pushBookFiles.size,
        pullBookFiles: plan.pullBookFiles.size,
        pushBookConfigs: plan.pushBookConfigs.size,
        pullBookConfigs: plan.pullBookConfigs.size,
        deleteBookFilesLocal: plan.deleteBookFilesLocal.size,
        deleteBookFilesRemote: plan.deleteBookFilesRemote.size,
        deleteBookConfigsLocal: plan.deleteBookConfigsLocal.size,
        deleteBookConfigsRemote: plan.deleteBookConfigsRemote.size,
      },
    };
  }

  static async testConnection(envConfig: EnvConfigType) {
    return await SyncService.testConnection(envConfig);
  }

  static async rebuildLocalSyncRecords(envConfig: EnvConfigType) {
    return await this.ensureLocalSyncRecords(envConfig, true);
  }
}

export default WebDAVRecordSyncService;
