import { WebDAVSyncSettings } from '@/types/settings';

export interface SyncTaskStats {
  total: number;
  completed: number;
  pending: number;
  running: number;
  hasFailedTasks: boolean;
}

export interface SyncTaskQueueLike {
  addTask<T>(task: () => Promise<T>): Promise<T>;
  getStats(): SyncTaskStats;
  resetCounters(): void;
  getDownloadedSize(): number;
  setDownloadedSize(size: number): void;
}

export interface SyncUtilLike {
  uploadFile(fileName: string, type: string, content: Blob | ArrayBuffer | string): Promise<boolean>;
  downloadFile(fileName: string, type: string): Promise<ArrayBuffer | false>;
  listFiles(type: string): Promise<string[]>;
  deleteFile(fileName: string, type: string): Promise<boolean>;
  isExist(fileName: string, type: string): Promise<boolean>;
  getStats(): SyncTaskStats;
  resetCounters(): void;
  getDownloadedSize(): number;
}

export interface SyncServiceConfig {
  service: 'webdav';
  webdav: WebDAVSyncSettings;
}
