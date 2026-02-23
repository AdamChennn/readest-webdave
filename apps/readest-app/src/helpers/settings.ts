import { ViewSettings } from '@/types/book';
import { SystemSettings } from '@/types/settings';
import { EnvConfigType } from '@/services/environment';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { getStyles } from '@/utils/style';

const isSettingValueEqual = <T>(a: T, b: T) => {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    return false;
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

export const saveViewSettings = async <K extends keyof ViewSettings>(
  envConfig: EnvConfigType,
  bookKey: string,
  key: K,
  value: ViewSettings[K],
  skipGlobal = false,
  applyStyles = true,
) => {
  const { settings, isSettingsGlobal, setSettings, saveSettings } = useSettingsStore.getState();
  const { bookKeys, getView, getViewState, getViewSettings, setViewSettings } =
    useReaderStore.getState();
  const { getConfig, saveConfig } = useBookDataStore.getState();

  const applyViewSettings = async (
    targetBookKey: string,
    settingsForSave: typeof settings,
    shouldApplyStyles: boolean,
  ) => {
    const viewSettings = getViewSettings(targetBookKey);
    const viewState = getViewState(targetBookKey);
    if (targetBookKey && viewSettings && !isSettingValueEqual(viewSettings[key], value)) {
      const nextViewSettings = {
        ...viewSettings,
        [key]: value,
      };
      setViewSettings(targetBookKey, nextViewSettings);
      if (shouldApplyStyles) {
        const view = getView(targetBookKey);
        view?.renderer.setStyles?.(getStyles(nextViewSettings));
      }
      const config = getConfig(targetBookKey);
      if (viewState?.isPrimary && config) {
        await saveConfig(envConfig, targetBookKey, config, settingsForSave);
      }
    }
  };

  if (isSettingsGlobal && !skipGlobal) {
    const currentGlobalValue = settings.globalViewSettings[key];
    if (isSettingValueEqual(currentGlobalValue, value)) return;

    const nextSettings = {
      ...settings,
      globalViewSettings: {
        ...settings.globalViewSettings,
        [key]: value,
      },
    };
    setSettings(nextSettings);

    for (const targetBookKey of bookKeys) {
      await applyViewSettings(targetBookKey, nextSettings, applyStyles);
    }
    await saveSettings(envConfig, nextSettings);
  } else if (bookKey) {
    await applyViewSettings(bookKey, settings, applyStyles);
  }
};

export const saveSysSettings = async <K extends keyof SystemSettings>(
  envConfig: EnvConfigType,
  key: K,
  value: SystemSettings[K],
) => {
  const { settings, setSettings, saveSettings } = useSettingsStore.getState();
  if (isSettingValueEqual(settings[key], value)) return;

  const nextSettings = {
    ...settings,
    [key]: value,
  };
  setSettings(nextSettings);
  await saveSettings(envConfig, nextSettings);
};
