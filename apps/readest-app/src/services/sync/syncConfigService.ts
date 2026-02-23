import { EnvConfigType } from '@/services/environment';
import { SETTINGS_FILENAME, SYNC_RECORD_FILENAME } from '@/services/constants';
import { EXTS } from '@/libs/document';
import { Book } from '@/types/book';
import { getCoverFilename, getLibraryFilename, getLocalBookFilename } from '@/utils/book';
import type { BaseDir } from '@/types/system';
import SyncService from './syncService';

const FILE_TYPE = 'config';
const BOOK_FILE_TYPE = 'books';
const LIBRARY_FILENAME = getLibraryFilename();
const getBookConfigRemoteFilename = (bookHash: string) => `bookconfig-${bookHash}.json`;
const getBookConfigLocalPath = (bookHash: string) => `${bookHash}/config.json`;
const getBookCoverRemoteFilename = (bookHash: string) => `cover-${bookHash}.png`;
const getBookContentRemoteFilename = (book: Book) => `book-${book.hash}.${EXTS[book.format]}`;

class SyncConfigService {
  private static async getBookByHash(
    envConfig: EnvConfigType,
    bookHash: string,
  ): Promise<Book | undefined> {
    const appService = await envConfig.getAppService();
    const books = await appService.loadLibraryBooks();
    return books.find((book) => book.hash === bookHash);
  }

  private static async resolveExistingLocalBookPath(
    envConfig: EnvConfigType,
    book: Book,
  ): Promise<string | null> {
    const appService = await envConfig.getAppService();
    const localPath = getLocalBookFilename(book);
    if (await appService.exists(localPath, 'Books')) return localPath;

    if (!(await appService.exists(book.hash, 'Books'))) return null;
    const entries = await appService.readDirectory(book.hash, 'Books');
    const extension = `.${EXTS[book.format]}`.toLowerCase();
    const candidate = entries.find((entry) => {
      const path = entry.path.toLowerCase();
      return (
        path.endsWith(extension) &&
        !path.endsWith('/cover.png') &&
        !path.endsWith('/config.json') &&
        !path.endsWith('cover.png') &&
        !path.endsWith('config.json')
      );
    });
    if (!candidate) return null;
    return `${book.hash}/${candidate.path}`;
  }

  static async uploadConfigFile(
    envConfig: EnvConfigType,
    filename: string,
    baseDir: BaseDir = 'Settings',
  ): Promise<boolean> {
    const util = await SyncService.getSyncUtil(envConfig);
    if (!util) return false;
    const appService = await envConfig.getAppService();
    const fallback = baseDir === 'Books' ? '[]' : '{}';
    const txt = (await appService.readFile(filename, baseDir, 'text')) as string;
    return await util.uploadFile(filename, FILE_TYPE, txt || fallback);
  }

  static async downloadConfigFile(
    envConfig: EnvConfigType,
    filename: string,
    baseDir: BaseDir = 'Settings',
  ): Promise<string> {
    const util = await SyncService.getSyncUtil(envConfig);
    const fallback = baseDir === 'Books' ? '[]' : '{}';
    if (!util) return fallback;
    const appService = await envConfig.getAppService();
    const content = await util.downloadFile(filename, FILE_TYPE);
    if (!content) return fallback;
    const text = new TextDecoder().decode(content);
    await appService.writeFile(filename, baseDir, text);
    return text;
  }

  static async uploadSettings(envConfig: EnvConfigType): Promise<boolean> {
    return await this.uploadConfigFile(envConfig, SETTINGS_FILENAME);
  }

  static async uploadSyncRecord(envConfig: EnvConfigType): Promise<boolean> {
    return await this.uploadConfigFile(envConfig, SYNC_RECORD_FILENAME);
  }

  static async downloadSettings(envConfig: EnvConfigType): Promise<string> {
    return await this.downloadConfigFile(envConfig, SETTINGS_FILENAME);
  }

  static async downloadSyncRecord(envConfig: EnvConfigType): Promise<string> {
    return await this.downloadConfigFile(envConfig, SYNC_RECORD_FILENAME);
  }

  static async uploadLibrary(envConfig: EnvConfigType): Promise<boolean> {
    return await this.uploadConfigFile(envConfig, LIBRARY_FILENAME, 'Books');
  }

  static async downloadLibrary(envConfig: EnvConfigType): Promise<string> {
    return await this.downloadConfigFile(envConfig, LIBRARY_FILENAME, 'Books');
  }

  static async pushCoreConfigs(envConfig: EnvConfigType): Promise<boolean> {
    const [settingsOk, syncOk, libraryOk] = await Promise.all([
      this.uploadSettings(envConfig),
      this.uploadSyncRecord(envConfig),
      this.uploadLibrary(envConfig),
    ]);
    return settingsOk && syncOk && libraryOk;
  }

  static async pullCoreConfigs(
    envConfig: EnvConfigType,
  ): Promise<{ settings: string; sync: string; library: string }> {
    const [settings, sync, library] = await Promise.all([
      this.downloadSettings(envConfig),
      this.downloadSyncRecord(envConfig),
      this.downloadLibrary(envConfig),
    ]);
    return { settings, sync, library };
  }

  static async uploadBookConfig(envConfig: EnvConfigType, bookHash: string): Promise<boolean> {
    const util = await SyncService.getSyncUtil(envConfig);
    if (!util) return false;
    const appService = await envConfig.getAppService();
    const localPath = getBookConfigLocalPath(bookHash);
    if (!(await appService.exists(localPath, 'Books'))) return false;
    const txt = (await appService.readFile(localPath, 'Books', 'text')) as string;
    return await util.uploadFile(getBookConfigRemoteFilename(bookHash), FILE_TYPE, txt || '{}');
  }

  static async downloadBookConfig(envConfig: EnvConfigType, bookHash: string): Promise<boolean> {
    const util = await SyncService.getSyncUtil(envConfig);
    if (!util) return false;
    const appService = await envConfig.getAppService();
    const content = await util.downloadFile(getBookConfigRemoteFilename(bookHash), FILE_TYPE);
    if (!content) return false;
    const text = new TextDecoder().decode(content);
    await appService.writeFile(getBookConfigLocalPath(bookHash), 'Books', text || '{}');
    return true;
  }

  static async deleteBookConfig(envConfig: EnvConfigType, bookHash: string): Promise<boolean> {
    const util = await SyncService.getSyncUtil(envConfig);
    if (!util) return false;
    const appService = await envConfig.getAppService();
    const localPath = getBookConfigLocalPath(bookHash);
    if (await appService.exists(localPath, 'Books')) {
      await appService.deleteFile(localPath, 'Books');
    }
    await util.deleteFile(getBookConfigRemoteFilename(bookHash), FILE_TYPE);
    return true;
  }

  static async uploadBookAssets(envConfig: EnvConfigType, bookHash: string): Promise<boolean> {
    const util = await SyncService.getSyncUtil(envConfig);
    if (!util) return false;

    const book = await this.getBookByHash(envConfig, bookHash);
    if (!book || book.deletedAt) return false;
    const appService = await envConfig.getAppService();

    let uploaded = false;
    const localBookPath = await this.resolveExistingLocalBookPath(envConfig, book);
    if (localBookPath) {
      const bookContent = await appService.readFile(localBookPath, 'Books', 'binary');
      await util.uploadFile(
        getBookContentRemoteFilename(book),
        BOOK_FILE_TYPE,
        bookContent as ArrayBuffer,
      );
      uploaded = true;
    }

    const localCoverPath = getCoverFilename(book);
    if (await appService.exists(localCoverPath, 'Books')) {
      const coverContent = await appService.readFile(localCoverPath, 'Books', 'binary');
      await util.uploadFile(
        getBookCoverRemoteFilename(book.hash),
        BOOK_FILE_TYPE,
        coverContent as ArrayBuffer,
      );
      uploaded = true;
    }

    return uploaded;
  }

  static async downloadBookAssets(
    envConfig: EnvConfigType,
    bookHash: string,
    options?: { force?: boolean },
  ): Promise<boolean> {
    const util = await SyncService.getSyncUtil(envConfig);
    if (!util) return false;

    const book = await this.getBookByHash(envConfig, bookHash);
    if (!book || book.deletedAt) return false;
    const appService = await envConfig.getAppService();
    if (!(await appService.exists(book.hash, 'Books'))) {
      await appService.createDir(book.hash, 'Books');
    }

    const force = !!options?.force;
    const localBookPath = getLocalBookFilename(book);
    const localCoverPath = getCoverFilename(book);

    const needBook = force || !(await appService.exists(localBookPath, 'Books'));
    if (needBook) {
      const bookContent = await util.downloadFile(getBookContentRemoteFilename(book), BOOK_FILE_TYPE);
      if (!bookContent) return false;
      await appService.writeFile(localBookPath, 'Books', bookContent as ArrayBuffer);
    }

    const needCover = force || !(await appService.exists(localCoverPath, 'Books'));
    if (needCover) {
      const coverContent = await util.downloadFile(getBookCoverRemoteFilename(book.hash), BOOK_FILE_TYPE);
      if (coverContent) {
        await appService.writeFile(localCoverPath, 'Books', coverContent as ArrayBuffer);
      }
    }

    return true;
  }

  static async deleteBookAssetsRemote(envConfig: EnvConfigType, bookHash: string): Promise<boolean> {
    const util = await SyncService.getSyncUtil(envConfig);
    if (!util) return false;

    for (const ext of Object.values(EXTS)) {
      await util.deleteFile(`book-${bookHash}.${ext}`, BOOK_FILE_TYPE);
    }
    await util.deleteFile(getBookCoverRemoteFilename(bookHash), BOOK_FILE_TYPE);
    return true;
  }

  static async deleteBookAssetsLocal(envConfig: EnvConfigType, bookHash: string): Promise<boolean> {
    const appService = await envConfig.getAppService();
    if (await appService.exists(bookHash, 'Books')) {
      await appService.deleteDir(bookHash, 'Books', true);
    }
    return true;
  }
}

export default SyncConfigService;
