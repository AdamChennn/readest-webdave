'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { Book } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useGamepad } from '@/hooks/useGamepad';
import { useTranslation } from '@/hooks/useTranslation';
import { parseOpenWithFiles } from '@/helpers/openWith';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { UnlistenFn } from '@tauri-apps/api/event';
import { tauriHandleClose, tauriHandleOnCloseWindow } from '@/utils/window';
import { isTauriAppPlatform } from '@/services/environment';
import { uniqueId } from '@/utils/misc';
import { throttle } from '@/utils/throttle';
import { eventDispatcher } from '@/utils/event';
import { navigateToLibrary } from '@/utils/nav';
import { BOOK_IDS_SEPARATOR } from '@/services/constants';
import { BookDetailModal } from '@/components/metadata';

import useBooksManager from '../hooks/useBooksManager';
import useBookShortcuts from '../hooks/useBookShortcuts';
import Spinner from '@/components/Spinner';
import SideBar from './sidebar/SideBar';
import Notebook from './notebook/Notebook';
import BooksGrid from './BooksGrid';
import SettingsDialog from '@/components/settings/SettingsDialog';

const ReaderContent: React.FC<{ ids?: string }> = ({ ids }) => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { envConfig, appService } = useEnv();
  const { bookKeys, dismissBook, getNextBookKey } = useBooksManager();
  const { sideBarBookKey, setSideBarBookKey } = useSidebarStore();
  const { setSettings, saveSettings } = useSettingsStore();
  const { getConfig, getBookData, saveConfig } = useBookDataStore();
  const { getView, setBookKeys, getViewSettings } = useReaderStore();
  const { initViewState, getViewState, clearViewState } = useReaderStore();
  const { isSettingsDialogOpen, settingsDialogBookKey } = useSettingsStore();
  const [showDetailsBook, setShowDetailsBook] = useState<Book | null>(null);
  const isInitiating = useRef(false);
  const [loading, setLoading] = useState(false);
  const [errorLoading, setErrorLoading] = useState(false);
  const hasScheduledFallback = useRef(false);
  const hasScheduledEmptyFallback = useRef(false);

  useBookShortcuts({ sideBarBookKey, bookKeys });
  useGamepad();

  useEffect(() => {
    if (isInitiating.current) return;
    isInitiating.current = true;

    const pathname = window.location.pathname;
    const bookIds = ids || searchParams?.get('ids') || pathname.split('/reader/')[1] || '';
    const initialIds = bookIds.split(BOOK_IDS_SEPARATOR).filter(Boolean);
    const initialBookKeys = initialIds.map((id) => `${id}-${uniqueId()}`);
    setBookKeys(initialBookKeys);
    const uniqueIds = new Set<string>();
    console.log('Initialize books', initialBookKeys);
    initialBookKeys.forEach((key, index) => {
      const id = key.split('-')[0]!;
      const isPrimary = !uniqueIds.has(id);
      uniqueIds.add(id);
      if (!getViewState(key)) {
        initViewState(envConfig, id, key, isPrimary).catch((error) => {
          console.log('Error initializing book', key, error);
          setErrorLoading(true);
          eventDispatcher.dispatch('toast', {
            message: _('Unable to open book'),
            callback: navigateBackToLibrary,
            timeout: 2000,
            type: 'error',
          });
          if (!hasScheduledFallback.current) {
            hasScheduledFallback.current = true;
            setTimeout(() => navigateBackToLibrary(), 300);
          }
        });
        if (index === 0) setSideBarBookKey(key);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleShowBookDetails = (event: CustomEvent) => {
      setShowDetailsBook(event.detail as Book);
      return true;
    };
    eventDispatcher.onSync('show-book-details', handleShowBookDetails);

    return () => {
      eventDispatcher.offSync('show-book-details', handleShowBookDetails);
    };
  }, []);

  useEffect(() => {
    if (bookKeys && bookKeys.length > 0) {
      const currentSettings = useSettingsStore.getState().settings;
      const lastOpenBooks = bookKeys.map((key) => key.split('-')[0]!);
      if (currentSettings.lastOpenBooks?.toString() !== lastOpenBooks.toString()) {
        const nextSettings = {
          ...currentSettings,
          lastOpenBooks,
        };
        setSettings(nextSettings);
        saveSettings(envConfig, nextSettings);
      }
    }

    let unlistenOnCloseWindow: Promise<UnlistenFn>;
    if (isTauriAppPlatform()) {
      unlistenOnCloseWindow = tauriHandleOnCloseWindow(handleCloseBooks);
    }
    window.addEventListener('beforeunload', handleCloseBooks);
    eventDispatcher.on('beforereload', handleCloseBooks);
    eventDispatcher.on('close-reader', handleCloseBooks);
    eventDispatcher.on('quit-app', handleCloseBooks);
    return () => {
      window.removeEventListener('beforeunload', handleCloseBooks);
      eventDispatcher.off('beforereload', handleCloseBooks);
      eventDispatcher.off('close-reader', handleCloseBooks);
      eventDispatcher.off('quit-app', handleCloseBooks);
      unlistenOnCloseWindow?.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKeys]);

  const saveBookConfig = async (bookKey: string) => {
    const config = getConfig(bookKey);
    const { book } = getBookData(bookKey) || {};
    const { isPrimary } = getViewState(bookKey) || {};
    if (isPrimary && book && config) {
      const settings = useSettingsStore.getState().settings;
      await saveConfig(envConfig, bookKey, config, settings);
    }
  };

  const saveConfigAndCloseBook = async (bookKey: string) => {
    console.log('Closing book', bookKey);

    try {
      getView(bookKey)?.close();
      getView(bookKey)?.remove();
    } catch {
      console.info('Error closing book', bookKey);
    }
    eventDispatcher.dispatch('tts-stop', { bookKey });
    await saveBookConfig(bookKey);
    clearViewState(bookKey);
  };

  const navigateBackToLibrary = () => {
    navigateToLibrary(router, '', undefined, true);
  };

  const saveSettingsAndGoToLibrary = () => {
    saveSettings(envConfig, useSettingsStore.getState().settings);
    navigateBackToLibrary();
  };

  const handleCloseBooks = throttle(async () => {
    const settings = useSettingsStore.getState().settings;
    await Promise.all(bookKeys.map(async (key) => await saveConfigAndCloseBook(key)));
    await saveSettings(envConfig, settings);
  }, 200);

  const handleCloseBooksToLibrary = () => {
    handleCloseBooks();
    if (isTauriAppPlatform()) {
      const currentWindow = getCurrentWindow();
      if (currentWindow.label === 'main') {
        navigateBackToLibrary();
      } else {
        currentWindow.close();
      }
    } else {
      navigateBackToLibrary();
    }
  };

  const handleCloseBook = async (bookKey: string) => {
    saveConfigAndCloseBook(bookKey);
    if (sideBarBookKey === bookKey) {
      setSideBarBookKey(getNextBookKey(sideBarBookKey));
    }
    dismissBook(bookKey);
    if (bookKeys.filter((key) => key !== bookKey).length == 0) {
      const openWithFiles = (await parseOpenWithFiles(appService)) || [];
      if (appService?.hasWindow) {
        if (openWithFiles.length > 0) {
          tauriHandleOnCloseWindow(handleCloseBooks);
          return await tauriHandleClose();
        }
        const currentWindow = getCurrentWindow();
        if (currentWindow.label.startsWith('reader')) {
          return await currentWindow.close();
        }
      }
      saveSettingsAndGoToLibrary();
    }
  };

  const primaryBookKey = bookKeys?.[0];
  const bookData = primaryBookKey ? getBookData(primaryBookKey) : undefined;
  const viewSettings = primaryBookKey ? getViewSettings(primaryBookKey) : undefined;
  useEffect(() => {
    if (!bookKeys || bookKeys.length === 0) {
      if (!hasScheduledEmptyFallback.current) {
        hasScheduledEmptyFallback.current = true;
        setTimeout(() => navigateBackToLibrary(), 0);
      }
    } else {
      hasScheduledEmptyFallback.current = false;
    }
  }, [bookKeys]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!primaryBookKey || !bookData || !bookData.book || !bookData.bookDoc || !viewSettings) {
      if (!errorLoading) {
        timer = setTimeout(() => setLoading(true), 200);
      }
    } else {
      setLoading(false);
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [primaryBookKey, bookData, viewSettings, errorLoading]);

  if (!bookKeys || bookKeys.length === 0) {
    return (
      <div className='hero hero-content full-height flex-col gap-3'>
        <div className='text-base-content/80 text-sm'>{_('Unable to open book')}</div>
        <button className='btn btn-primary btn-sm' onClick={navigateBackToLibrary}>
          {_('Back to library')}
        </button>
      </div>
    );
  }

  if (errorLoading) {
    return (
      <div className='hero hero-content full-height flex-col gap-3'>
        <div className='text-base-content/80 text-sm'>{_('Unable to open book')}</div>
        <button className='btn btn-primary btn-sm' onClick={navigateBackToLibrary}>
          {_('Back to library')}
        </button>
      </div>
    );
  }

  if (!bookData || !bookData.book || !bookData.bookDoc || !viewSettings) {
    return (
      loading &&
      !errorLoading && (
        <div className='hero hero-content full-height'>
          <Spinner loading={true} />
        </div>
      )
    );
  }

  return (
    <div className='reader-content full-height flex'>
      <SideBar />
      <BooksGrid
        bookKeys={bookKeys}
        onCloseBook={handleCloseBook}
        onGoToLibrary={handleCloseBooksToLibrary}
      />
      {isSettingsDialogOpen && <SettingsDialog bookKey={settingsDialogBookKey} isOpen={isSettingsDialogOpen} />}
      <Notebook />
      {showDetailsBook && (
        <BookDetailModal
          isOpen={!!showDetailsBook}
          book={showDetailsBook}
          onClose={() => setShowDetailsBook(null)}
        />
      )}
    </div>
  );
};

export default ReaderContent;
