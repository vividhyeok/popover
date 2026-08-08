export type StudyMode = "listen" | "dictation";

export type LyricLine = {
  id: string;
  start: number;
  end: number;
  english: string;
  korean?: string;
  note?: string;
};

export type LineProgress = {
  draft: string;
  wordDrafts?: string[];
  wordResults?: Array<"correct" | "wrong" | null>;
  attempts: number;
  bestScore: number;
  completed: boolean;
};

export type SongProgress = {
  position: number;
  activeLine: number;
  lineProgress: Record<string, LineProgress>;
  lastStudiedAt: number;
};

export type Song = {
  id: string;
  title: string;
  artist: string;
  videoId?: string;
  thumbnail: string;
  duration: number;
  source: "demo" | "genie" | "manual";
  genieId?: string;
  lyrics: LyricLine[];
  syncOffsetMs: number;
  createdAt: number;
  progress: SongProgress;
};

export type AppSettings = {
  maxSongs: number;
  autoAdvance: boolean;
  showKoreanInDictation: boolean;
};

export type PersistedState = {
  version: 1;
  songs: Song[];
  selectedSongId: string;
  settings: AppSettings;
};
