import { useCallback, useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { SYNC_BOOKS_INTERVAL_SEC } from '@/services/constants';
import { throttle } from '@/utils/throttle';
import { eventDispatcher } from '@/utils/event';
import WebDAVRecordSyncService from '@/services/sync/webdavRecordSyncService';
import { isWebDAVUnavailableError } from '@/services/sync/errors';

export const useBooksSync = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { libraryLoaded, library } = useLibraryStore();
  const isWebDAVSyncEnabled = settings.syncMode === 'webdav' && !!settings.webdav?.enabled;
  const isPullingRef = useRef(false);
  const lastUnavailableToastAtRef = useRef(0);

  const notifyUnavailable = useCallback(() => {
    const now = Date.now();
    // Avoid spamming the same toast during periodic auto-sync retries.
    if (now - lastUnavailableToastAtRef.current < 15000) return;
    lastUnavailableToastAtRef.current = now;
    eventDispatcher.dispatch('toast', {
      type: 'error',
      message: _('WebDAV 同步不可用'),
    });
  }, [_]);

  const pullLibrary = useCallback(
    async (_fullRefresh = false, verbose = false) => {
      if (!isWebDAVSyncEnabled) return;
      if (isPullingRef.current) return;
      try {
        isPullingRef.current = true;
        const result = await WebDAVRecordSyncService.sync(envConfig, 'both');
        if (verbose) {
          eventDispatcher.dispatch('toast', {
            type: result.ok ? 'success' : 'error',
            message: result.ok ? _('WebDAV 双向同步完成') : _('WebDAV 同步失败'),
          });
        }
      } catch (error) {
        if (isWebDAVUnavailableError(error)) {
          notifyUnavailable();
          return;
        }
        throw error;
      } finally {
        isPullingRef.current = false;
      }
    },
    [_, envConfig, isWebDAVSyncEnabled, notifyUnavailable],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleAutoSync = useCallback(
    throttle(
      () => {
        if (!isWebDAVSyncEnabled) return;
        WebDAVRecordSyncService.sync(envConfig, 'push').catch((error) => {
          if (isWebDAVUnavailableError(error)) {
            notifyUnavailable();
            return;
          }
          console.error('Auto WebDAV sync failed:', error);
        });
      },
      SYNC_BOOKS_INTERVAL_SEC * 1000,
      { emitLast: true },
    ),
    [envConfig, isWebDAVSyncEnabled, notifyUnavailable],
  );

  useEffect(() => {
    if (!isWebDAVSyncEnabled) return;
    if (isPullingRef.current) return;
    handleAutoSync();
  }, [isWebDAVSyncEnabled, library, handleAutoSync]);

  const pushLibrary = useCallback(async () => {
    if (!isWebDAVSyncEnabled) return;
    await WebDAVRecordSyncService.sync(envConfig, 'push');
  }, [envConfig, isWebDAVSyncEnabled]);

  useEffect(() => {
    if (!isWebDAVSyncEnabled || !libraryLoaded) return;
    pullLibrary();
  }, [isWebDAVSyncEnabled, libraryLoaded, pullLibrary]);

  return { pullLibrary, pushLibrary };
};
