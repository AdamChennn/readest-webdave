import { EnvConfigType } from '@/services/environment';
import { SyncServiceConfig, SyncUtilLike } from './types';
import { WebDAVSyncUtil } from './providers/WebDAVSyncUtil';

class SyncService {
  private static syncUtilCache: Record<string, SyncUtilLike> = {};

  static async getSyncConfig(envConfig: EnvConfigType): Promise<SyncServiceConfig | null> {
    const appService = await envConfig.getAppService();
    const settings = await appService.loadSettings();

    if (settings.syncMode !== 'webdav' || !settings.webdav?.enabled) {
      return null;
    }

    const webdav = settings.webdav;
    if (!webdav.url || !webdav.username || !webdav.password) {
      return null;
    }

    return {
      service: 'webdav',
      webdav,
    };
  }

  static async getSyncUtil(envConfig: EnvConfigType, isUseCache = true): Promise<SyncUtilLike | null> {
    const config = await this.getSyncConfig(envConfig);
    if (!config) return null;

    const cacheKey = `${config.service}:${config.webdav.url}:${config.webdav.username}:${config.webdav.baseFolder}`;
    if (!isUseCache || !this.syncUtilCache[cacheKey]) {
      this.syncUtilCache[cacheKey] = new WebDAVSyncUtil(config.webdav);
    }
    return this.syncUtilCache[cacheKey]!;
  }

  static async removeSyncUtil(envConfig: EnvConfigType) {
    const config = await this.getSyncConfig(envConfig);
    if (!config) return;
    const cacheKey = `${config.service}:${config.webdav.url}:${config.webdav.username}:${config.webdav.baseFolder}`;
    delete this.syncUtilCache[cacheKey];
  }

  static async testConnection(envConfig: EnvConfigType): Promise<boolean> {
    const util = await this.getSyncUtil(envConfig, false);
    if (!util) return false;
    const testFile = `test-${Date.now()}.txt`;
    const ok = await util.uploadFile(testFile, 'config', 'Hello world!');
    if (!ok) return false;
    await util.deleteFile(testFile, 'config');
    return true;
  }
}

export default SyncService;
