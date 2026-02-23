export type SyncRecordOperation = 'save' | 'update' | 'delete';

export interface SyncRecordItem {
  operation: SyncRecordOperation;
  time: number;
}

export interface SyncRecordKey {
  type: 'database' | 'config';
  catergory: string;
  name: string;
  key: string;
}

export type SyncRecordMap = Record<string, SyncRecordItem>;

export const toSyncRecordKey = (item: SyncRecordKey) =>
  `${item.type}.${item.catergory}.${item.name}.${item.key}`;
