import clsx from 'clsx';
import React, { useState } from 'react';
import { PiGear } from 'react-icons/pi';
import { PiSun, PiMoon } from 'react-icons/pi';
import { TbSunMoon } from 'react-icons/tb';

import { invoke, PermissionState } from '@tauri-apps/api/core';
import { isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';
import { DOWNLOAD_READEST_URL } from '@/services/constants';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useFileSelector } from '@/hooks/useFileSelector';
import { tauriHandleSetAlwaysOnTop } from '@/utils/window';
import { setMigrateDataDirDialogVisible } from '@/app/library/components/MigrateDataWindow';
import { requestStoragePermission } from '@/utils/permission';
import { saveSysSettings } from '@/helpers/settings';
import { selectDirectory } from '@/utils/bridge';
import { eventDispatcher } from '@/utils/event';
import WebDAVRecordSyncService from '@/services/sync/webdavRecordSyncService';
import { SyncRecordService } from '@/services/sync/syncRecordService';
import SyncService from '@/services/sync/syncService';
import { useCustomFontStore } from '@/store/customFontStore';
import { mountCustomFont } from '@/styles/fonts';
import MenuItem from '@/components/MenuItem';
import Menu from '@/components/Menu';
import Dialog from '@/components/Dialog';

interface SettingsMenuProps {
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

interface Permissions {
  postNotification: PermissionState;
  manageStorage: PermissionState;
}

const SettingsMenu: React.FC<SettingsMenuProps> = ({ setIsDropdownOpen }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { themeMode, setThemeMode } = useThemeStore();
  const { settings, setSettings, saveSettings, setSettingsDialogOpen } = useSettingsStore();
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(settings.alwaysOnTop);
  const [isAlwaysShowStatusBar, setIsAlwaysShowStatusBar] = useState(settings.alwaysShowStatusBar);
  const [isOpenLastBooks, setIsOpenLastBooks] = useState(settings.openLastBooks);
  const [isAutoImportBooksOnOpen, setIsAutoImportBooksOnOpen] = useState(
    settings.autoImportBooksOnOpen,
  );
  const [alwaysInForeground, setAlwaysInForeground] = useState(settings.alwaysInForeground);
  const [savedBookCoverForLockScreen, setSavedBookCoverForLockScreen] = useState(
    settings.savedBookCoverForLockScreen || '',
  );
  const [isTestingWebDAV, setIsTestingWebDAV] = useState(false);
  const [isSyncingWebDAV, setIsSyncingWebDAV] = useState(false);
  const [isWebDAVDialogOpen, setIsWebDAVDialogOpen] = useState(false);
  const [isSavingWebDAV, setIsSavingWebDAV] = useState(false);
  const [isImportingFonts, setIsImportingFonts] = useState(false);
  const [webdavDraft, setWebdavDraft] = useState({
    url: '',
    username: '',
    password: '',
    baseFolder: 'Readest',
  });
  const iconSize = useResponsiveSize(16);
  const isWebDAVReady =
    settings.syncMode === 'webdav' &&
    !!settings.webdav?.enabled &&
    !!settings.webdav?.url &&
    !!settings.webdav?.username &&
    !!settings.webdav?.password;

  const { selectFiles } = useFileSelector(appService, _);
  const { addFont, loadFont, saveCustomFonts } = useCustomFontStore();

  const downloadReadest = () => {
    window.open(DOWNLOAD_READEST_URL, '_blank');
    setIsDropdownOpen?.(false);
  };

  const cycleThemeMode = () => {
    const nextMode = themeMode === 'auto' ? 'light' : themeMode === 'light' ? 'dark' : 'auto';
    setThemeMode(nextMode);
  };

  const toggleOpenInNewWindow = () => {
    saveSysSettings(envConfig, 'openBookInNewWindow', !settings.openBookInNewWindow);
    setIsDropdownOpen?.(false);
  };

  const toggleAlwaysOnTop = () => {
    const newValue = !settings.alwaysOnTop;
    saveSysSettings(envConfig, 'alwaysOnTop', newValue);
    setIsAlwaysOnTop(newValue);
    tauriHandleSetAlwaysOnTop(newValue);
    setIsDropdownOpen?.(false);
  };

  const toggleAlwaysShowStatusBar = () => {
    const newValue = !settings.alwaysShowStatusBar;
    saveSysSettings(envConfig, 'alwaysShowStatusBar', newValue);
    setIsAlwaysShowStatusBar(newValue);
  };

  const toggleAutoImportBooksOnOpen = () => {
    const newValue = !settings.autoImportBooksOnOpen;
    saveSysSettings(envConfig, 'autoImportBooksOnOpen', newValue);
    setIsAutoImportBooksOnOpen(newValue);
  };

  const toggleOpenLastBooks = () => {
    const newValue = !settings.openLastBooks;
    saveSysSettings(envConfig, 'openLastBooks', newValue);
    setIsOpenLastBooks(newValue);
  };

  const handleSetRootDir = () => {
    setMigrateDataDirDialogVisible(true);
    setIsDropdownOpen?.(false);
  };

  const openSettingsDialog = () => {
    setIsDropdownOpen?.(false);
    setSettingsDialogOpen(true);
  };

  const handleImportFonts = async () => {
    if (isImportingFonts) return;
    setIsImportingFonts(true);
    try {
      const result = await selectFiles({ type: 'fonts', multiple: true });
      if (result.error) {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('字体文件选择失败'),
        });
        return;
      }
      if (!result.files.length) return;

      let imported = 0;
      for (const selectedFile of result.files) {
        const fontInfo = await appService?.importFont(selectedFile.path || selectedFile.file);
        if (!fontInfo) continue;
        const customFont = addFont(fontInfo.path, {
          name: fontInfo.name,
          family: fontInfo.family,
          style: fontInfo.style,
          weight: fontInfo.weight,
          variable: fontInfo.variable,
        });
        const loadedFont = await loadFont(envConfig, customFont.id);
        mountCustomFont(document, loadedFont);
        imported++;
      }
      await saveCustomFonts(envConfig);
      eventDispatcher.dispatch('toast', {
        type: imported > 0 ? 'success' : 'info',
        message: imported > 0 ? _('已导入 {{count}} 个字体', { count: imported }) : _('未导入字体'),
      });
    } catch (error) {
      console.error('Import fonts failed:', error);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('导入字体失败'),
      });
    } finally {
      setIsImportingFonts(false);
    }
  };

  const handleTestWebDAVConnection = async () => {
    if (!isWebDAVReady) {
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('请先配置 WebDAV'),
      });
      return;
    }
    if (isTestingWebDAV) return;
    setIsTestingWebDAV(true);
    try {
      const ok = await WebDAVRecordSyncService.testConnection(envConfig);
      eventDispatcher.dispatch('toast', {
        type: ok ? 'success' : 'error',
        message: ok ? _('WebDAV 连接成功') : _('WebDAV 连接失败'),
      });
    } catch (error) {
      console.error('Test WebDAV connection failed:', error);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('WebDAV 连接失败'),
      });
    } finally {
      setIsTestingWebDAV(false);
    }
  };

  const handleManualWebDAVSync = async () => {
    if (!isWebDAVReady) {
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('请先配置 WebDAV'),
      });
      return;
    }
    if (isSyncingWebDAV) return;
    setIsSyncingWebDAV(true);
    try {
      const result = await WebDAVRecordSyncService.sync(envConfig, 'both');
      if (!result.ok) throw new Error('webdav pull failed');
      const now = Date.now();
      saveSysSettings(envConfig, 'lastSyncedAtConfigs', now);
      eventDispatcher.dispatch('toast', {
        type: 'success',
        message: _('WebDAV 双向同步完成'),
      });
    } catch (error) {
      console.error('WebDAV bidirectional sync failed:', error);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('WebDAV 同步失败'),
      });
    } finally {
      setIsSyncingWebDAV(false);
    }
  };

  const handleConfigureWebDAV = () => {
    const current = settings.webdav || {
      enabled: false,
      url: '',
      username: '',
      password: '',
      baseFolder: 'Readest',
    };
    setWebdavDraft({
      url: current.url || '',
      username: current.username || '',
      password: current.password || '',
      baseFolder: current.baseFolder || 'Readest',
    });
    setIsWebDAVDialogOpen(true);
  };

  const handleSaveWebDAVConfig = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSavingWebDAV) return;
    const url = webdavDraft.url.trim();
    const username = webdavDraft.username.trim();
    const password = webdavDraft.password;
    const baseFolder = (webdavDraft.baseFolder.trim() || 'Readest').replace(/^\/+|\/+$/g, '');
    if (!url || !username || !password) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('WebDAV 地址、用户名和密码不能为空'),
      });
      return;
    }
    setIsSavingWebDAV(true);
    const nextSettings = {
      ...settings,
      syncMode: 'webdav' as const,
      webdav: {
        enabled: true,
        url,
        username,
        password,
        baseFolder,
      },
    };
    try {
      setSettings(nextSettings);
      await saveSettings(envConfig, nextSettings);
      await SyncService.removeSyncUtil(envConfig);
      await SyncRecordService.setSyncRecord(
        envConfig,
        { type: 'config', catergory: 'readerConfig', name: 'settings', key: 'syncMode' },
        { operation: 'update', time: Date.now() },
      );
      await SyncRecordService.setSyncRecord(
        envConfig,
        { type: 'config', catergory: 'readerConfig', name: 'settings', key: 'webdav' },
        { operation: 'update', time: Date.now() },
      );
      eventDispatcher.dispatch('toast', {
        type: 'success',
        message: _('WebDAV 配置已保存'),
      });
      setIsWebDAVDialogOpen(false);
    } catch (error) {
      console.error('Save WebDAV configuration failed:', error);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('保存 WebDAV 配置失败'),
      });
    } finally {
      setIsSavingWebDAV(false);
    }
  };

  const handleSetSavedBookCoverForLockScreen = async () => {
    if (!(await requestStoragePermission()) && appService?.distChannel === 'readest') return;

    const newValue = settings.savedBookCoverForLockScreen ? '' : 'default';
    if (newValue) {
      const response = await selectDirectory();
      if (response.path) {
        saveSysSettings(envConfig, 'savedBookCoverForLockScreenPath', response.path);
      }
    }
    saveSysSettings(envConfig, 'savedBookCoverForLockScreen', newValue);
    setSavedBookCoverForLockScreen(newValue);
  };

  const toggleAlwaysInForeground = async () => {
    const requestAlwaysInForeground = !settings.alwaysInForeground;

    if (requestAlwaysInForeground) {
      let permission = await invoke<Permissions>('plugin:native-tts|checkPermissions');
      if (permission.postNotification !== 'granted') {
        permission = await invoke<Permissions>('plugin:native-tts|requestPermissions', {
          permissions: ['postNotification'],
        });
      }
      if (permission.postNotification !== 'granted') return;
    }

    saveSysSettings(envConfig, 'alwaysInForeground', requestAlwaysInForeground);
    setAlwaysInForeground(requestAlwaysInForeground);
  };

  const themeModeLabel =
    themeMode === 'dark'
      ? _('Dark Mode')
      : themeMode === 'light'
        ? _('Light Mode')
        : _('Auto Mode');

  const savedBookCoverPath = settings.savedBookCoverForLockScreenPath;
  const coverDir = savedBookCoverPath ? savedBookCoverPath.split('/').pop() : 'Images';
  const savedBookCoverDescription = `💾 ${coverDir}/last-book-cover.png`;

  return (
    <>
      <Menu
        className={clsx(
          'settings-menu dropdown-content no-triangle',
          'z-20 mt-2 max-w-[90vw] shadow-2xl',
        )}
        onCancel={() => setIsDropdownOpen?.(false)}
      >
      {isTauriAppPlatform() && !appService?.isMobile && (
        <MenuItem
          label={_('Auto Import on File Open')}
          toggled={isAutoImportBooksOnOpen}
          onClick={toggleAutoImportBooksOnOpen}
        />
      )}
      {isTauriAppPlatform() && (
        <MenuItem
          label={_('Open Last Book on Start')}
          toggled={isOpenLastBooks}
          onClick={toggleOpenLastBooks}
        />
      )}
      <hr aria-hidden='true' className='border-base-200 my-1' />
      {appService?.hasWindow && (
        <MenuItem
          label={_('Open Book in New Window')}
          toggled={settings.openBookInNewWindow}
          onClick={toggleOpenInNewWindow}
        />
      )}
      {appService?.hasWindow && (
        <MenuItem label={_('Always on Top')} toggled={isAlwaysOnTop} onClick={toggleAlwaysOnTop} />
      )}
      {appService?.isMobileApp && (
        <MenuItem
          label={_('Always Show Status Bar')}
          toggled={isAlwaysShowStatusBar}
          onClick={toggleAlwaysShowStatusBar}
        />
      )}
      {appService?.isAndroidApp && (
        <MenuItem
          label={_(_('Background Read Aloud'))}
          toggled={alwaysInForeground}
          onClick={toggleAlwaysInForeground}
        />
      )}
      <MenuItem
        label={isImportingFonts ? _('正在导入字体...') : _('导入字体文件')}
        onClick={handleImportFonts}
        disabled={isImportingFonts}
      />
      <MenuItem
        label={themeModeLabel}
        Icon={themeMode === 'dark' ? PiMoon : themeMode === 'light' ? PiSun : TbSunMoon}
        onClick={cycleThemeMode}
      />
      <MenuItem label={_('Settings')} Icon={PiGear} onClick={openSettingsDialog} />
      <MenuItem label={_('WebDAV 同步')} onClick={handleConfigureWebDAV} />
      {appService?.canCustomizeRootDir && (
        <>
          <hr aria-hidden='true' className='border-base-200 my-1' />
          <MenuItem label={_('Advanced Settings')}>
            <ul
              className='ms-0 flex flex-col before:hidden'
              style={{
                paddingInlineStart: `${iconSize}px`,
              }}
            >
              <MenuItem
                label={_('Change Data Location')}
                noIcon={!appService?.isAndroidApp}
                onClick={handleSetRootDir}
              />
              {appService?.isAndroidApp && appService?.distChannel !== 'playstore' && (
                <MenuItem
                  label={_('Save Book Cover')}
                  tooltip={_('Auto-save last book cover')}
                  description={savedBookCoverForLockScreen ? savedBookCoverDescription : ''}
                  toggled={!!savedBookCoverForLockScreen}
                  onClick={handleSetSavedBookCoverForLockScreen}
                />
              )}
            </ul>
          </MenuItem>
        </>
      )}
      {isWebAppPlatform() && <MenuItem label={_('Download Readest')} onClick={downloadReadest} />}
      </Menu>
      <Dialog
        isOpen={isWebDAVDialogOpen}
        title={_('WebDAV 同步')}
        onClose={() => {
          if (isSavingWebDAV) return;
          setIsWebDAVDialogOpen(false);
        }}
        boxClassName='sm:min-w-[560px] sm:max-w-[560px] sm:h-auto sm:max-h-[90%]'
        contentClassName='!px-4 !pb-4 !pt-2'
      >
        <form className='flex flex-col gap-3' onSubmit={handleSaveWebDAVConfig}>
          <div className='form-control w-full'>
            <label className='label' htmlFor='webdav-url'>
              <span className='label-text'>{_('WebDAV 地址')}</span>
            </label>
            <input
              id='webdav-url'
              type='url'
              className='input input-bordered w-full'
              value={webdavDraft.url}
              onChange={(e) => setWebdavDraft((prev) => ({ ...prev, url: e.target.value }))}
              placeholder='https://dav.example.com/remote.php/dav/files/username'
              required
              disabled={isSavingWebDAV}
            />
          </div>
          <div className='form-control w-full'>
            <label className='label' htmlFor='webdav-username'>
              <span className='label-text'>{_('用户名')}</span>
            </label>
            <input
              id='webdav-username'
              type='text'
              className='input input-bordered w-full'
              value={webdavDraft.username}
              onChange={(e) => setWebdavDraft((prev) => ({ ...prev, username: e.target.value }))}
              placeholder={_('用户名')}
              autoComplete='username'
              required
              disabled={isSavingWebDAV}
            />
          </div>
          <div className='form-control w-full'>
            <label className='label' htmlFor='webdav-password'>
              <span className='label-text'>{_('密码')}</span>
            </label>
            <input
              id='webdav-password'
              type='password'
              className='input input-bordered w-full'
              value={webdavDraft.password}
              onChange={(e) => setWebdavDraft((prev) => ({ ...prev, password: e.target.value }))}
              placeholder={_('密码')}
              autoComplete='current-password'
              required
              disabled={isSavingWebDAV}
            />
          </div>
          <div className='form-control w-full'>
            <label className='label' htmlFor='webdav-folder'>
              <span className='label-text'>{_('远端目录')}</span>
            </label>
            <input
              id='webdav-folder'
              type='text'
              className='input input-bordered w-full'
              value={webdavDraft.baseFolder}
              onChange={(e) => setWebdavDraft((prev) => ({ ...prev, baseFolder: e.target.value }))}
              placeholder='Readest'
              disabled={isSavingWebDAV}
            />
          </div>
          <div className='modal-action mt-1'>
            <button
              type='button'
              className='btn'
              onClick={() => setIsWebDAVDialogOpen(false)}
              disabled={isSavingWebDAV}
            >
              {_('取消')}
            </button>
            <button
              type='button'
              className='btn'
              onClick={handleTestWebDAVConnection}
              disabled={isTestingWebDAV || isSavingWebDAV}
            >
              {isTestingWebDAV ? _('测试中...') : _('测试连接')}
            </button>
            <button
              type='button'
              className='btn'
              onClick={handleManualWebDAVSync}
              disabled={isSyncingWebDAV || isSavingWebDAV || !isWebDAVReady}
            >
              {isSyncingWebDAV ? _('同步中...') : _('立即同步')}
            </button>
            <button type='submit' className='btn btn-primary' disabled={isSavingWebDAV}>
              {isSavingWebDAV ? _('保存中...') : _('保存配置')}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
};

export default SettingsMenu;
