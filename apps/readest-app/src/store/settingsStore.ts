import i18n from '@/i18n/i18n';
import { create } from 'zustand';
import { SystemSettings } from '@/types/settings';
import { EnvConfigType } from '@/services/environment';
import { initDayjs } from '@/utils/time';

export type FontPanelView = 'main-fonts' | 'custom-fonts';
const SETTINGS_SAVE_DEBOUNCE_MS = 600;

let pendingSave:
  | {
      envConfig: EnvConfigType;
      settings: SystemSettings;
    }
  | null = null;
let pendingSaveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSaveResolvers: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
let lastSavedSnapshot: string | null = null;

const flushPendingSave = async () => {
  if (!pendingSave) return;
  const { envConfig, settings } = pendingSave;
  const resolvers = pendingSaveResolvers;
  pendingSave = null;
  pendingSaveResolvers = [];
  pendingSaveTimer = null;

  try {
    const snapshot = JSON.stringify(settings);
    if (snapshot === lastSavedSnapshot) {
      resolvers.forEach((item) => item.resolve());
      return;
    }
    const appService = await envConfig.getAppService();
    await appService.saveSettings(settings);
    lastSavedSnapshot = snapshot;
    resolvers.forEach((item) => item.resolve());
  } catch (error) {
    resolvers.forEach((item) => item.reject(error));
  }
};

const scheduleSettingsSave = async (envConfig: EnvConfigType, settings: SystemSettings) => {
  pendingSave = { envConfig, settings };
  if (pendingSaveTimer) {
    clearTimeout(pendingSaveTimer);
  }

  return await new Promise<void>((resolve, reject) => {
    pendingSaveResolvers.push({ resolve, reject });
    pendingSaveTimer = setTimeout(() => {
      flushPendingSave().catch((error) => {
        console.error('Failed to flush pending settings save:', error);
      });
    }, SETTINGS_SAVE_DEBOUNCE_MS);
  });
};

interface SettingsState {
  settings: SystemSettings;
  settingsDialogBookKey: string;
  isSettingsDialogOpen: boolean;
  isSettingsGlobal: boolean;
  fontPanelView: FontPanelView;
  activeSettingsItemId: string | null;
  setSettings: (settings: SystemSettings) => void;
  saveSettings: (envConfig: EnvConfigType, settings: SystemSettings) => void;
  setSettingsDialogBookKey: (bookKey: string) => void;
  setSettingsDialogOpen: (open: boolean) => void;
  setSettingsGlobal: (global: boolean) => void;
  setFontPanelView: (view: FontPanelView) => void;
  setActiveSettingsItemId: (id: string | null) => void;

  applyUILanguage: (uiLanguage?: string) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: {} as SystemSettings,
  settingsDialogBookKey: '',
  isSettingsDialogOpen: false,
  isSettingsGlobal: true,
  fontPanelView: 'main-fonts',
  activeSettingsItemId: null,
  setSettings: (settings) => set({ settings }),
  saveSettings: async (envConfig: EnvConfigType, settings: SystemSettings) => {
    await scheduleSettingsSave(envConfig, settings);
  },
  setSettingsDialogBookKey: (bookKey) => set({ settingsDialogBookKey: bookKey }),
  setSettingsDialogOpen: (open) => set({ isSettingsDialogOpen: open }),
  setSettingsGlobal: (global) => set({ isSettingsGlobal: global }),
  setFontPanelView: (view) => set({ fontPanelView: view }),
  setActiveSettingsItemId: (id) => set({ activeSettingsItemId: id }),

  applyUILanguage: (uiLanguage?: string) => {
    const locale = uiLanguage ? uiLanguage : navigator.language;
    i18n.changeLanguage(locale);
    initDayjs(locale);
  },
}));
