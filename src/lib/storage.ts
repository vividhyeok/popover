import { demoSong } from "./demo";
import type { PersistedState } from "./types";

export const STORAGE_KEY = "popover.study.v1";

export const defaultState: PersistedState = {
  version: 1,
  songs: [demoSong],
  selectedSongId: demoSong.id,
  settings: {
    maxSongs: 8,
    autoAdvance: true,
    showKoreanInDictation: true,
    dictationAutoRepeat: true,
  },
};

export function loadState(): PersistedState {
  if (typeof window === "undefined") return defaultState;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw) as PersistedState;
    if (parsed.version !== 1 || !Array.isArray(parsed.songs)) return defaultState;
    return {
      ...defaultState,
      ...parsed,
      settings: { ...defaultState.settings, ...parsed.settings },
    };
  } catch {
    return defaultState;
  }
}

export function saveState(state: PersistedState) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
