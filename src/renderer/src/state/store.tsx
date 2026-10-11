import { createContext, useCallback, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { Settings } from '@shared/settings';
import { defaultSettings } from '@shared/settings';
import type { ChapterListItem } from '@shared/ipc';

export type Screen = 'Reader' | 'Catalog' | 'Popular' | 'Library' | 'Favorites' | 'History' | 'Downloads' | 'Settings';

export type OpenedGallery =
  | { kind: 'local'; id: string; title: string; pageCount: number; pages: string[]; url: string; startPage: number }
  | {
      kind: 'online';
      id: string;
      title: string;
      pageCount: number;
      source: string;
      url: string;
      startPage: number;
      mangaId: string | null;
      coverUrl?: string | null;
      chapterList?: ChapterListItem[] | null;
      chapterIndex?: number | null;
      webtoon?: boolean;
    };

interface Store {
  screen: Screen;
  setScreen: (s: Screen) => void;
  settings: Settings;
  setSettings: (s: Settings) => void;
  opened: OpenedGallery | null;
  setOpened: Dispatch<SetStateAction<OpenedGallery | null>>;
  pendingChapterList: { mangaId: string; title: string } | null;
  setPendingChapterList: (v: { mangaId: string; title: string } | null) => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const [screen, setScreenState] = useState<Screen>(() => {
    const saved = sessionStorage.getItem('mr:screen');
    const valid =
      saved === 'Catalog' ||
      saved === 'Popular' ||
      saved === 'Library' ||
      saved === 'Favorites' ||
      saved === 'History' ||
      saved === 'Downloads' ||
      saved === 'Settings';
    return valid ? (saved as Screen) : 'Catalog';
  });
  const setScreen = useCallback((s: Screen): void => {
    setScreenState(s);
    // Remember the last non-Reader screen (Reader is transient — a restored
    // online gallery id would be stale after a restart).
    if (s !== 'Reader') sessionStorage.setItem('mr:screen', s);
  }, []);
  const [settings, setSettingsState] = useState<Settings>(defaultSettings());
  const [opened, setOpened] = useState<OpenedGallery | null>(null);
  const [pendingChapterList, setPendingChapterList] = useState<{ mangaId: string; title: string } | null>(null);

  useEffect(() => {
    window.api.getSettings().then(setSettingsState);
  }, []);

  useEffect(() => window.api.onSettingsChanged(setSettingsState), []);

  const setSettings = (s: Settings): void => {
    setSettingsState(s);
    window.api.setSettings(s);
  };

  return (
    <Ctx.Provider
      value={{
        screen,
        setScreen,
        settings,
        setSettings,
        opened,
        setOpened,
        pendingChapterList,
        setPendingChapterList,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore outside provider');
  return v;
}
