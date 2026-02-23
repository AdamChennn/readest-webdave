import { describe, expect, it } from 'vitest';
import { toSyncRecordKey } from '@/types/sync';

describe('sync record key format', () => {
  it('matches koodo style key pattern', () => {
    expect(
      toSyncRecordKey({
        type: 'database',
        catergory: 'sqlite',
        name: 'books',
        key: 'book-hash',
      }),
    ).toBe('database.sqlite.books.book-hash');
  });

  it('supports config key records', () => {
    expect(
      toSyncRecordKey({
        type: 'config',
        catergory: 'readerConfig',
        name: 'settings',
        key: 'autoUpload',
      }),
    ).toBe('config.readerConfig.settings.autoUpload');
  });
});
