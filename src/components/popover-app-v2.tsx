"use client";

/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock3,
  Download,
  ExternalLink,
  Eye,
  Keyboard,
  Languages,
  Library,
  Link2,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatTime, normalizeAnswer, parseLrc } from "@/lib/lrc";
import { mergeLyricLines, type LyricMergeSuggestion } from "@/lib/lyric-merge";
import { defaultState, loadState, saveState } from "@/lib/storage";
import type { LineProgress, PersistedState, Song, StudyMode } from "@/lib/types";
import { YouTubePlayer, type YouTubePlayerHandle } from "./youtube-player";

type Toast = { message: string; tone?: "normal" | "error" | "success" };
type GenieResult = { id: string; title: string; artist: string };
type YouTubeResult = { videoId: string; title: string; artist: string; thumbnail: string };
type ImportedTranslation = { korean: string; note?: string };
type LyricFilter = "all" | "starred" | "review";

const EMPTY_PROGRESS: LineProgress = {
  draft: "",
  wordDrafts: [],
  wordResults: [],
  revealed: false,
  attempts: 0,
  bestScore: 0,
  completed: false,
  starred: false,
};

const normalizeWordAnswer = (value: string) => normalizeAnswer(value).replace(/[\s']/g, "");
const normalizedLineKey = (value: string) => value.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

const isNonStudyLine = (english: string) => {
  const value = english.trim();
  if (!value) return true;
  if (/^\[[^\]]+\]$/.test(value)) return true;
  return /^(intro|outro|instrumental|interlude|verse\s*\d*|chorus|pre[-\s]?chorus|bridge|hook|refrain|전주|간주|후주)(\s*[:\-].*)?$/i.test(value);
};

const sectionLabel = (english: string) => english.trim().replace(/^\[|\]$/g, "");

const splitWordPunctuation = (value: string) => {
  const match = value.match(/^([^A-Za-z0-9-]*)(.*?[A-Za-z0-9-])([^A-Za-z0-9-]*)$/);
  return match ? { prefix: match[1], core: match[2], suffix: match[3] } : { prefix: "", core: value, suffix: "" };
};

async function requestLyricMergeSuggestions(target: Pick<Song, "title" | "artist" | "lyrics">) {
  let lastError = "가사 구조 분석에 실패했습니다.";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch("/api/lyrics/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: target.title,
        artist: target.artist,
        lyrics: target.lyrics.map(({ start, end, english }) => ({ start, end, english })),
      }),
    });
    const data = await response.json() as { merges?: LyricMergeSuggestion[]; fallback?: boolean; error?: string; code?: string };
    if (response.ok) return data.merges ?? [];
    lastError = data.error ?? lastError;
    if (data.code !== "UPSTREAM_TIMEOUT" || attempt === 1) break;
  }
  throw new Error(lastError);
}

function genieScore(video: YouTubeResult, result: GenieResult) {
  const clean = (value: string) => value
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/official|video|audio|lyrics?|mv|music/g, " ")
    .replace(/[^a-z0-9가-힣]+/g, " ")
    .trim();
  const tokens = (value: string) => new Set(clean(value).split(/\s+/).filter(Boolean));
  const source = tokens(`${video.artist} ${video.title}`);
  const target = tokens(`${result.artist} ${result.title}`);
  let score = 0;
  target.forEach((token) => { if (source.has(token)) score += token.length > 2 ? 3 : 1; });
  return score;
}

export function PopoverAppV2() {
  const [app, setApp] = useState<PersistedState>(defaultState);
  const [hydrated, setHydrated] = useState(false);
  const [mode, setMode] = useState<StudyMode>("listen");
  const [currentTime, setCurrentTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [dictationLineIndex, setDictationLineIndex] = useState<number | null>(null);
  const [loopLine, setLoopLine] = useState(false);
  const [showMeaning, setShowMeaning] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [dictationMeaning, setDictationMeaning] = useState(false);
  const [lyricFilter, setLyricFilter] = useState<LyricFilter>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [translationOpen, setTranslationOpen] = useState(false);
  const [mergingLyrics, setMergingLyrics] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const playerRef = useRef<YouTubePlayerHandle>(null);
  const currentTimeRef = useRef(0);
  const wordInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const activeLyricRowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setApp(loadState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => saveState(app), 180);
    return () => window.clearTimeout(timer);
  }, [app, hydrated]);

  const song = useMemo(
    () => app.songs.find((item) => item.id === app.selectedSongId) ?? app.songs[0],
    [app.selectedSongId, app.songs],
  );

  const effectiveTime = currentTime + (song?.syncOffsetMs ?? 0) / 1000;
  const trackedIndex = useMemo(() => {
    if (!song?.lyrics.length) return -1;
    let result = -1;
    for (let index = 0; index < song.lyrics.length; index += 1) {
      if (song.lyrics[index].start <= effectiveTime) result = index;
      else break;
    }
    return result;
  }, [effectiveTime, song]);

  const studyLineIndexes = useMemo(
    () => song?.lyrics.map((line, index) => ({ line, index })).filter(({ line }) => !isNonStudyLine(line.english)).map(({ index }) => index) ?? [],
    [song],
  );

  const studyNumberByIndex = useMemo(() => {
    const map = new Map<number, number>();
    studyLineIndexes.forEach((index, position) => map.set(index, position + 1));
    return map;
  }, [studyLineIndexes]);

  const nearestStudyIndex = useCallback((index: number) => {
    if (!studyLineIndexes.length) return 0;
    const exactOrNext = studyLineIndexes.find((value) => value >= index);
    return exactOrNext ?? studyLineIndexes.at(-1) ?? 0;
  }, [studyLineIndexes]);

  const activeIndex = mode === "dictation" && dictationLineIndex !== null
    ? dictationLineIndex
    : trackedIndex;
  const activeLine = activeIndex >= 0 ? song?.lyrics[activeIndex] : undefined;
  const duration = playerDuration || song?.duration || song?.lyrics.at(-1)?.end || 0;
  const activeWords = useMemo(() => activeLine && !isNonStudyLine(activeLine.english) ? activeLine.english.trim().split(/\s+/).filter(Boolean) : [], [activeLine?.id]);
  const activeProgress = activeLine ? song?.progress.lineProgress[activeLine.id] ?? EMPTY_PROGRESS : EMPTY_PROGRESS;
  const showTrackerKorean = Boolean(app.settings.showTrackerKorean);

  const showToast = useCallback((message: string, tone: Toast["tone"] = "normal") => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  const updateSong = useCallback((id: string, updater: (value: Song) => Song) => {
    setApp((state) => ({ ...state, songs: state.songs.map((item) => item.id === id ? updater(item) : item) }));
  }, []);

  useEffect(() => {
    if (!song) return;
    currentTimeRef.current = song.progress.position || 0;
    setCurrentTime(song.progress.position || 0);
    setPlayerDuration(song.duration || 0);
    setPlaying(false);
    setLyricFilter("all");
  }, [song?.id]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    setShowMeaning(false);
    setShowNote(false);
    setDictationMeaning(false);
  }, [activeLine?.id, song?.id]);

  useEffect(() => {
    if (!song) return;
    const timer = window.setInterval(() => {
      updateSong(song.id, (value) => ({
        ...value,
        progress: { ...value.progress, position: currentTimeRef.current, activeLine: Math.max(activeIndex, 0), lastStudiedAt: Date.now() },
      }));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [song?.id, activeIndex, updateSong]);

  useEffect(() => {
    const row = activeLyricRowRef.current;
    if (!row) return;
    window.requestAnimationFrame(() => row.scrollIntoView({ block: "nearest" }));
  }, [activeIndex, mode, lyricFilter]);

  useEffect(() => {
    if (mode !== "dictation") {
      setDictationLineIndex(null);
      return;
    }
    setDictationLineIndex(nearestStudyIndex(Math.max(trackedIndex, 0)));
  }, [mode, song?.id]);

  const seekTo = useCallback((seconds: number) => {
    const safe = Math.max(0, Math.min(seconds, duration || seconds));
    if (song?.videoId) playerRef.current?.seekTo(safe);
    else setCurrentTime(safe);
  }, [duration, song?.videoId]);

  const seekLine = useCallback((index: number) => {
    if (!song?.lyrics[index]) return;
    seekTo(song.lyrics[index].start - song.syncOffsetMs / 1000);
  }, [seekTo, song]);

  const navigateStudyLine = useCallback((direction: -1 | 1) => {
    if (!studyLineIndexes.length) return;
    const position = studyLineIndexes.indexOf(activeIndex);
    const nextPosition = Math.max(0, Math.min((position < 0 ? 0 : position) + direction, studyLineIndexes.length - 1));
    const next = studyLineIndexes[nextPosition];
    if (mode === "dictation") setDictationLineIndex(next);
    seekLine(next);
  }, [activeIndex, mode, seekLine, studyLineIndexes]);

  const handlePlayerTime = useCallback((time: number, nextDuration: number) => {
    currentTimeRef.current = time;
    setCurrentTime(time);
    if (nextDuration > 0) setPlayerDuration(nextDuration);
  }, []);

  const togglePlayback = useCallback(() => {
    if (!song) return;
    if (song.videoId) playerRef.current?.toggle();
    else setPlaying((value) => !value);
  }, [song]);

  const setRate = (rate: number) => {
    setPlaybackRate(rate);
    playerRef.current?.setRate(rate);
  };

  useEffect(() => {
    if (!playing || !song || !activeLine) return;
    const shouldRepeat = mode === "dictation" ? app.settings.dictationAutoRepeat : loopLine;
    if (!shouldRepeat || effectiveTime < activeLine.end - 0.12) return;
    seekLine(activeIndex);
  }, [activeIndex, activeLine, app.settings.dictationAutoRepeat, effectiveTime, loopLine, mode, playing, seekLine, song]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable || target.closest(".dialog-backdrop")) return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
      } else if (mode === "listen" && event.key.toLowerCase() === "j") navigateStudyLine(-1);
      else if (mode === "listen" && event.key.toLowerCase() === "k") navigateStudyLine(1);
      else if (mode === "listen" && event.key.toLowerCase() === "r") setLoopLine((value) => !value);
      else if (mode === "listen" && event.key.toLowerCase() === "t") setShowMeaning((value) => !value);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, navigateStudyLine, togglePlayback]);

  const alignLineToNow = (index: number) => {
    if (!song?.lyrics[index]) return;
    const exactTime = song.videoId ? playerRef.current?.getCurrentTime() ?? currentTimeRef.current : currentTimeRef.current;
    const effectiveNow = exactTime + song.syncOffsetMs / 1000;
    const sourceStart = song.lyrics[index].start;
    const delta = effectiveNow - sourceStart;
    const round = (value: number) => Math.round(value * 1000) / 1000;
    updateSong(song.id, (value) => {
      const shifted = value.lyrics.map((line, lineIndex) => lineIndex >= index
        ? { ...line, start: round(line.start + delta), end: round(line.end + delta) }
        : { ...line });
      if (index > 0 && shifted[index]) {
        shifted[index - 1] = { ...shifted[index - 1], end: Math.max(shifted[index - 1].start + 0.2, shifted[index].start) };
      }
      return {
        ...value,
        lyrics: shifted,
        originalLyrics: value.originalLyrics?.map((line) => line.start >= sourceStart
          ? { ...line, start: round(line.start + delta), end: round(line.end + delta) }
          : line),
      };
    });
    showToast(`이 문장부터 현재 재생 위치에 맞췄습니다.`, "success");
  };

  const toggleStar = (lineId: string) => {
    if (!song) return;
    updateSong(song.id, (value) => {
      const before = value.progress.lineProgress[lineId] ?? EMPTY_PROGRESS;
      return {
        ...value,
        progress: {
          ...value.progress,
          lineProgress: {
            ...value.progress.lineProgress,
            [lineId]: { ...before, starred: !before.starred },
          },
        },
      };
    });
  };

  const focusWord = (index: number) => {
    window.requestAnimationFrame(() => {
      wordInputRefs.current[index]?.focus({ preventScroll: true });
      wordInputRefs.current[index]?.select();
    });
  };

  const setWordDraft = (wordIndex: number, draft: string) => {
    if (!song || !activeLine) return;
    updateSong(song.id, (value) => {
      const before = value.progress.lineProgress[activeLine.id] ?? EMPTY_PROGRESS;
      const drafts = [...(before.wordDrafts ?? [])];
      const results = [...(before.wordResults ?? [])];
      drafts[wordIndex] = draft;
      if (results[wordIndex] !== "correct") results[wordIndex] = null;
      return {
        ...value,
        progress: {
          ...value.progress,
          lineProgress: {
            ...value.progress.lineProgress,
            [activeLine.id]: { ...before, wordDrafts: drafts, wordResults: results },
          },
        },
      };
    });
  };

  const checkWord = (wordIndex: number, rawDraft?: string) => {
    if (!song || !activeLine) return false;
    const draft = rawDraft?.trim() ?? activeProgress.wordDrafts?.[wordIndex]?.trim() ?? "";
    if (!draft) return false;
    const correct = normalizeWordAnswer(draft) === normalizeWordAnswer(activeWords[wordIndex] ?? "") && !activeProgress.revealed;
    const nextResults = [...(activeProgress.wordResults ?? [])];
    nextResults[wordIndex] = correct ? "correct" : "wrong";
    const correctCount = activeWords.filter((_, index) => nextResults[index] === "correct").length;
    const completed = activeWords.length > 0 && correctCount === activeWords.length;
    const score = activeWords.length ? Math.round((correctCount / activeWords.length) * 100) : 0;
    updateSong(song.id, (value) => {
      const before = value.progress.lineProgress[activeLine.id] ?? EMPTY_PROGRESS;
      return {
        ...value,
        progress: {
          ...value.progress,
          lineProgress: {
            ...value.progress.lineProgress,
            [activeLine.id]: {
              ...before,
              wordResults: nextResults,
              attempts: before.attempts + 1,
              bestScore: Math.max(before.bestScore, score),
              completed: before.completed || completed,
            },
          },
        },
      };
    });
    if (correct) {
      const next = activeWords.findIndex((_, index) => index > wordIndex && nextResults[index] !== "correct");
      if (next >= 0) focusWord(next);
    }
    return completed;
  };

  const deferWord = (wordIndex: number) => {
    if (!song || !activeLine) return;
    updateSong(song.id, (value) => {
      const before = value.progress.lineProgress[activeLine.id] ?? EMPTY_PROGRESS;
      const results = [...(before.wordResults ?? [])];
      if (results[wordIndex] !== "correct") results[wordIndex] = "skipped";
      return {
        ...value,
        progress: {
          ...value.progress,
          lineProgress: { ...value.progress.lineProgress, [activeLine.id]: { ...before, wordResults: results, attempts: before.attempts + 1 } },
        },
      };
    });
  };

  const revealAnswer = () => {
    if (!song || !activeLine) return;
    updateSong(song.id, (value) => {
      const before = value.progress.lineProgress[activeLine.id] ?? EMPTY_PROGRESS;
      return {
        ...value,
        progress: {
          ...value.progress,
          lineProgress: { ...value.progress.lineProgress, [activeLine.id]: { ...before, revealed: true, attempts: before.attempts + 1 } },
        },
      };
    });
  };

  const addSong = (nextSong: Song, translateAfter: boolean) => {
    if (app.songs.length >= app.settings.maxSongs) {
      showToast("보관함이 가득 찼습니다. 설정에서 저장 한도를 늘려주세요.", "error");
      return false;
    }
    setApp((state) => ({ ...state, songs: [nextSong, ...state.songs], selectedSongId: nextSong.id }));
    setAddOpen(false);
    if (translateAfter) void translateSong(nextSong);
    showToast("곡을 추가했습니다.", "success");
    return true;
  };

  const translateSong = async (target: Song) => {
    if (translating) return;
    setTranslating(true);
    const batchSize = 8;
    const translations: Array<string | null> = target.lyrics.map((line) => line.korean ?? null);
    const notes: Array<string | null> = target.lyrics.map((line) => line.note ?? null);
    try {
      for (let startIndex = 0; startIndex < target.lyrics.length; startIndex += batchSize) {
        const endIndex = Math.min(startIndex + batchSize, target.lyrics.length);
        const response = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: target.title,
            artist: target.artist,
            lyrics: target.lyrics.map((line) => line.english),
            startIndex,
            endIndex,
            existingTranslations: translations,
            existingNotes: notes,
          }),
        });
        const data = await response.json() as { translations?: string[]; studyNotes?: Array<string | null>; error?: string };
        if (!response.ok || !data.translations) throw new Error(data.error ?? "번역에 실패했습니다.");
        data.translations.forEach((translation, offset) => {
          translations[startIndex + offset] = translation;
          notes[startIndex + offset] = data.studyNotes?.[offset] ?? null;
        });
        updateSong(target.id, (value) => ({
          ...value,
          lyrics: value.lyrics.map((line, index) => ({ ...line, korean: translations[index] ?? line.korean, note: notes[index] ?? undefined })),
        }));
      }
      showToast("번역을 준비했습니다.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "번역에 실패했습니다.", "error");
    } finally {
      setTranslating(false);
    }
  };

  const mergeCurrentSongLyrics = async () => {
    if (!song || mergingLyrics || song.lyrics.length < 2) return;
    setMergingLyrics(true);
    try {
      const source = song.originalLyrics?.length ? song.originalLyrics.map((line) => ({ ...line })) : song.lyrics.map((line) => ({ ...line }));
      const suggestions = await requestLyricMergeSuggestions({ ...song, lyrics: source });
      const merged = mergeLyricLines(source, suggestions);
      if (merged.lyrics.length === song.lyrics.length && merged.lyrics.every((line, index) => line.english === song.lyrics[index]?.english)) {
        showToast("이미 문장 단위로 정리되어 있습니다.");
        return;
      }
      const existing = new Map(song.lyrics.map((line) => [normalizedLineKey(line.english), line]));
      const lyrics = merged.lyrics.map((line) => {
        const match = existing.get(normalizedLineKey(line.english));
        return match ? { ...line, korean: match.korean, note: match.note } : line;
      });
      updateSong(song.id, (value) => ({
        ...value,
        lyrics,
        originalLyrics: source,
        progress: { ...value.progress, activeLine: 0, lineProgress: {}, lastStudiedAt: Date.now() },
      }));
      showToast("가사를 문장 단위로 다시 정리했습니다.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "가사 정리에 실패했습니다.", "error");
    } finally {
      setMergingLyrics(false);
    }
  };

  const removeSong = (id: string) => {
    const target = app.songs.find((item) => item.id === id);
    if (!target || !window.confirm(`“${target.title}”을 삭제할까요?`)) return;
    setApp((state) => {
      const songs = state.songs.filter((item) => item.id !== id);
      return { ...state, songs, selectedSongId: state.selectedSongId === id ? songs[0]?.id ?? "" : state.selectedSongId };
    });
  };

  const reviewCandidates = useMemo(() => {
    if (!song) return [] as number[];
    return studyLineIndexes
      .map((index) => {
        const line = song.lyrics[index];
        const progress = song.progress.lineProgress[line.id];
        if (!progress) return null;
        const wordCount = Math.max(1, line.english.trim().split(/\s+/).length);
        const extraAttempts = Math.max(0, progress.attempts - wordCount);
        const score = (progress.starred ? 120 : 0)
          + (progress.revealed ? 80 : 0)
          + (progress.completed ? 0 : 30)
          + Math.max(0, 100 - progress.bestScore)
          + Math.min(extraAttempts, 10) * 6;
        return score > 0 ? { index, score } : null;
      })
      .filter((item): item is { index: number; score: number } => Boolean(item))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((item) => item.index);
  }, [song, studyLineIndexes]);

  const starredIndexes = useMemo(
    () => song ? studyLineIndexes.filter((index) => song.progress.lineProgress[song.lyrics[index].id]?.starred) : [],
    [song, studyLineIndexes],
  );

  const visibleIndexes = lyricFilter === "starred" ? starredIndexes : lyricFilter === "review" ? reviewCandidates : song?.lyrics.map((_, index) => index) ?? [];

  const completedCount = song ? studyLineIndexes.filter((index) => song.progress.lineProgress[song.lyrics[index].id]?.completed).length : 0;
  const activeCorrectCount = activeProgress.wordResults?.filter((result) => result === "correct").length ?? 0;
  const activeWordsCompleted = activeWords.length > 0 && activeCorrectCount === activeWords.length;

  if (!hydrated) return <div className="simple-loading">Popover를 준비하고 있습니다…</div>;

  return (
    <main className={`simple-app ${app.settings.fontScale === "large" ? "font-large" : ""}`}>
      <header className="simple-topbar">
        <div className="simple-brand"><div className="brand-mark"><span /></div><strong>popover</strong></div>
        <div className="simple-mode-switch">
          <button className={mode === "listen" ? "active" : ""} onClick={() => setMode("listen")}><Languages size={16} /> 듣기</button>
          <button className={mode === "dictation" ? "active" : ""} onClick={() => setMode("dictation")}><Keyboard size={16} /> 받아쓰기</button>
        </div>
        <div className="simple-top-actions">
          <button className="simple-icon-text" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /> 설정</button>
          <button className="simple-primary" onClick={() => setAddOpen(true)}><Plus size={17} /> 곡 추가</button>
        </div>
      </header>

      <div className={`simple-workspace ${mode}`}>
        <aside className="simple-library">
          <div className="simple-library-head"><h2>곡</h2><span>{app.songs.length}/{app.settings.maxSongs}</span></div>
          <div className="simple-song-list">
            {app.songs.map((item) => (
              <div className={`simple-song ${item.id === song?.id ? "active" : ""}`} key={item.id}>
                <button className="simple-song-main" onClick={() => setApp((state) => ({ ...state, selectedSongId: item.id }))}>
                  <span className="simple-song-cover" style={{ backgroundImage: `url(${item.thumbnail})` }} />
                  <span><b>{item.title}</b><small>{item.artist}</small></span>
                </button>
                <button className="simple-song-delete" aria-label={`${item.title} 삭제`} onClick={() => removeSong(item.id)}><Trash2 size={14} /></button>
              </div>
            ))}
            {!app.songs.length ? <div className="simple-empty"><Library size={26} /><p>곡을 추가해보세요.</p></div> : null}
          </div>
        </aside>

        <section className="simple-player-column">
          {song ? <>
            <div className="simple-player-head">
              <div><h1>{song.title}</h1><p>{song.artist}</p></div>
              <details className="simple-song-menu">
                <summary aria-label="곡 메뉴"><MoreHorizontal size={20} /></summary>
                <div>
                  <button onClick={() => setTranslationOpen(true)}><Sparkles size={15} /> 번역 가져오기</button>
                  <button onClick={mergeCurrentSongLyrics} disabled={mergingLyrics}><Link2 size={15} /> {mergingLyrics ? "정리 중…" : "가사 문장 정리"}</button>
                  {song.videoId ? <a href={`https://youtu.be/${song.videoId}`} target="_blank" rel="noreferrer"><ExternalLink size={15} /> YouTube 열기</a> : null}
                </div>
              </details>
            </div>

            <div className="simple-video-stage">
              {song.videoId ? <YouTubePlayer
                key={`${song.id}-${song.videoId}`}
                ref={playerRef}
                videoId={song.videoId}
                initialTime={song.progress.position}
                onTime={handlePlayerTime}
                onPlayingChange={setPlaying}
                onReadyChange={() => undefined}
              /> : <div className="simple-demo" style={{ backgroundImage: `url(${song.thumbnail})` }} />}
            </div>

            {mode === "listen" ? <>
              <div className="simple-focus-card">
                <div className="simple-focus-meta">
                  <span>{activeIndex >= 0 && studyNumberByIndex.get(activeIndex) ? `${studyNumberByIndex.get(activeIndex)} / ${studyLineIndexes.length}` : ""}</span>
                  {activeLine ? <button className={activeProgress.starred ? "starred" : ""} onClick={() => toggleStar(activeLine.id)}><Star size={15} fill={activeProgress.starred ? "currentColor" : "none"} /> 저장</button> : null}
                </div>
                <p className="simple-focus-english">{activeLine && !isNonStudyLine(activeLine.english) ? activeLine.english : "재생하면 현재 가사가 여기에 표시됩니다."}</p>
                {activeLine?.korean && !isNonStudyLine(activeLine.english) ? <div className="simple-reveal-row"><button onClick={() => setShowMeaning((value) => !value)}><Eye size={14} /> {showMeaning ? "뜻 숨기기" : "뜻 보기"}</button>{activeLine.note ? <button onClick={() => setShowNote((value) => !value)}><Sparkles size={14} /> {showNote ? "표현 숨기기" : "표현 보기"}</button> : null}</div> : null}
                {showMeaning && activeLine?.korean ? <p className="simple-focus-korean">{activeLine.korean}</p> : null}
                {showNote && activeLine?.note ? <p className="simple-focus-note">{activeLine.note}</p> : null}
              </div>

              <div className="simple-transport">
                <div className="simple-timeline"><span>{formatTime(currentTime)}</span><input type="range" min={0} max={Math.max(duration, 1)} step={0.1} value={Math.min(currentTime, duration || 0)} onChange={(event) => seekTo(Number(event.target.value))} /><span>{formatTime(duration)}</span></div>
                <div className="simple-controls">
                  <button aria-label="이전 문장" onClick={() => navigateStudyLine(-1)}><ChevronLeft size={22} /></button>
                  <button className="simple-play" aria-label={playing ? "일시정지" : "재생"} onClick={togglePlayback}>{playing ? <Pause size={23} fill="currentColor" /> : <Play size={23} fill="currentColor" />}</button>
                  <button aria-label="다음 문장" onClick={() => navigateStudyLine(1)}><ChevronRight size={22} /></button>
                  <button className={loopLine ? "simple-text-control active" : "simple-text-control"} onClick={() => setLoopLine((value) => !value)}><RotateCcw size={14} /> 반복</button>
                  <label className="simple-rate">속도 <select value={playbackRate} onChange={(event) => setRate(Number(event.target.value))}><option value={0.75}>0.75×</option><option value={1}>1×</option><option value={1.25}>1.25×</option><option value={1.5}>1.5×</option></select></label>
                </div>
              </div>
            </> : <>
              <div className="simple-dictation-card">
                <div className="simple-dictation-head"><div><b>{studyNumberByIndex.get(activeIndex) ?? "–"}</b><span> / {studyLineIndexes.length}</span></div><span>{activeCorrectCount}/{activeWords.length}</span></div>
                {activeLine ? <>
                  {app.settings.showKoreanInDictation || dictationMeaning ? <div className="simple-dictation-meaning"><p>{activeLine.korean || "번역이 없습니다."}</p>{!app.settings.showKoreanInDictation ? <button onClick={() => setDictationMeaning(false)}>숨기기</button> : null}</div> : <button className="simple-hint-button" onClick={() => setDictationMeaning(true)}><Eye size={14} /> 뜻 힌트</button>}
                  <div className="simple-word-flow">
                    {activeWords.map((word, wordIndex) => {
                      const result = activeProgress.wordResults?.[wordIndex] ?? null;
                      const { prefix, core, suffix } = splitWordPunctuation(word);
                      const draft = activeProgress.wordDrafts?.[wordIndex] ?? "";
                      const displayed = activeProgress.revealed && result !== "correct" ? core : draft;
                      return <div className={`simple-word ${result ?? ""}`} key={`${activeLine.id}-${wordIndex}`}>
                        {prefix ? <span>{prefix}</span> : null}
                        <input
                          ref={(element) => { wordInputRefs.current[wordIndex] = element; }}
                          value={displayed}
                          readOnly={Boolean(activeProgress.revealed)}
                          placeholder="…"
                          autoComplete="off"
                          spellCheck={false}
                          onChange={(event) => setWordDraft(wordIndex, event.target.value)}
                          onKeyDown={(event) => {
                            if (event.nativeEvent.isComposing) return;
                            if ([" ", "Enter", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
                              event.preventDefault();
                              event.stopPropagation();
                            }
                            if (event.key === "ArrowLeft") focusWord(Math.max(0, wordIndex - 1));
                            else if (event.key === "ArrowRight") focusWord(Math.min(activeWords.length - 1, wordIndex + 1));
                            else if (event.key === "ArrowUp") navigateStudyLine(-1);
                            else if (event.key === "ArrowDown") navigateStudyLine(1);
                            else if (event.key === " " || event.key === "Enter") {
                              const draftValue = event.currentTarget.value.trim();
                              const completed = draftValue ? checkWord(wordIndex, draftValue) : (deferWord(wordIndex), false);
                              if (event.key === "Enter") {
                                if (wordIndex < activeWords.length - 1) focusWord(wordIndex + 1);
                                else if (app.settings.autoAdvance && (completed || activeWordsCompleted)) navigateStudyLine(1);
                              }
                            }
                          }}
                        />
                        {suffix ? <span>{suffix}</span> : null}
                      </div>;
                    })}
                  </div>
                  <div className="simple-dictation-foot"><button onClick={revealAnswer} disabled={Boolean(activeProgress.revealed)}><Eye size={14} /> {activeProgress.revealed ? "정답 공개됨" : "정답 보기"}</button><span>시도 {activeProgress.attempts} · 최고 {activeProgress.bestScore}%</span></div>
                </> : null}
              </div>
              <div className="simple-dictation-controls">
                <button onClick={() => navigateStudyLine(-1)}><ChevronLeft size={20} /></button>
                <button className="simple-play" onClick={togglePlayback}>{playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</button>
                <button onClick={() => navigateStudyLine(1)}><ChevronRight size={20} /></button>
                <label className="simple-rate">속도 <select value={playbackRate} onChange={(event) => setRate(Number(event.target.value))}><option value={0.75}>0.75×</option><option value={1}>1×</option><option value={1.25}>1.25×</option><option value={1.5}>1.5×</option></select></label>
                <button className={app.settings.dictationAutoRepeat ? "simple-text-control active" : "simple-text-control"} onClick={() => setApp((state) => ({ ...state, settings: { ...state.settings, dictationAutoRepeat: !state.settings.dictationAutoRepeat } }))}><RotateCcw size={14} /> 자동 반복</button>
              </div>
            </>}
          </> : <div className="simple-no-song"><Library size={34} /><h2>학습할 곡을 추가해주세요.</h2><button className="simple-primary" onClick={() => setAddOpen(true)}><Plus size={16} /> 곡 추가</button></div>}
        </section>

        <section className="simple-lyrics-panel">
          <div className="simple-lyrics-head">
            <div><h2>{mode === "dictation" ? "연습 문장" : "가사"}</h2>{mode === "dictation" ? <span>{completedCount}/{studyLineIndexes.length} 완료</span> : null}</div>
            <div className="simple-lyrics-tools">
              {mode === "listen" ? <button className={showTrackerKorean ? "active" : ""} onClick={() => setApp((state) => ({ ...state, settings: { ...state.settings, showTrackerKorean: !state.settings.showTrackerKorean } }))}>번역</button> : null}
              <button className={lyricFilter === "starred" ? "active" : ""} onClick={() => setLyricFilter((value) => value === "starred" ? "all" : "starred")}><Star size={14} /> {starredIndexes.length || ""}</button>
              <button className={lyricFilter === "review" ? "active" : ""} onClick={() => setLyricFilter((value) => value === "review" ? "all" : "review")}><RotateCcw size={14} /> 복습</button>
            </div>
          </div>

          <div className="simple-lyrics-scroll">
            {visibleIndexes.map((index) => {
              const line = song?.lyrics[index];
              if (!line) return null;
              const isSection = isNonStudyLine(line.english);
              if (isSection) return lyricFilter === "all" ? <div className="simple-section" key={line.id}><span>{sectionLabel(line.english)}</span></div> : null;
              const progress = song?.progress.lineProgress[line.id];
              const isActive = index === activeIndex;
              return <div ref={isActive ? activeLyricRowRef : undefined} className={`simple-lyric-row ${isActive ? "active" : ""}`} key={line.id}>
                <button className="simple-lyric-main" onClick={() => { if (mode === "dictation") setDictationLineIndex(index); seekLine(index); }}>
                  <span className="simple-line-index">{String(studyNumberByIndex.get(index) ?? 0).padStart(2, "0")}</span>
                  <span className="simple-line-copy">
                    {mode === "listen" ? <b>{line.english}</b> : <b>{line.korean || "뜻을 준비하지 못했습니다."}</b>}
                    {mode === "listen" && showTrackerKorean && line.korean ? <small>{line.korean}</small> : null}
                  </span>
                  {mode === "dictation" ? <span className="simple-line-progress">{progress?.completed ? <Check size={14} /> : `${progress?.bestScore ?? 0}%`}</span> : null}
                </button>
                <div className="simple-lyric-actions">
                  <button className={progress?.starred ? "starred" : ""} title="문장 저장" onClick={() => toggleStar(line.id)}><Star size={14} fill={progress?.starred ? "currentColor" : "none"} /></button>
                  {mode === "listen" ? <button title="이 문장을 현재 재생 위치에 맞추기" onClick={() => alignLineToNow(index)}><Clock3 size={14} /></button> : null}
                </div>
              </div>;
            })}
            {lyricFilter !== "all" && !visibleIndexes.length ? <div className="simple-filter-empty">아직 표시할 문장이 없습니다.</div> : null}
          </div>
        </section>
      </div>

      {addOpen ? <AddSongDialogV2 onClose={() => setAddOpen(false)} onAdd={addSong} songCount={app.songs.length} maxSongs={app.settings.maxSongs} /> : null}
      {settingsOpen ? <SettingsDialogV2 app={app} onChange={setApp} onClose={() => setSettingsOpen(false)} /> : null}
      {translationOpen && song ? <TranslationImportDialogV2 song={song} onClose={() => setTranslationOpen(false)} onApply={(translated) => {
        updateSong(song.id, (value) => ({ ...value, lyrics: value.lyrics.map((line, index) => ({ ...line, korean: translated[index].korean, note: translated[index].note })) }));
        setTranslationOpen(false);
        showToast("번역을 적용했습니다.", "success");
      }} /> : null}
      {toast ? <div className={`simple-toast ${toast.tone ?? "normal"}`}>{toast.tone === "success" ? <CircleCheck size={16} /> : toast.tone === "error" ? <AlertCircle size={16} /> : null}{toast.message}</div> : null}
    </main>
  );
}

function AddSongDialogV2({ onClose, onAdd, songCount, maxSongs }: {
  onClose: () => void;
  onAdd: (song: Song, translateAfter: boolean) => boolean;
  songCount: number;
  maxSongs: number;
}) {
  const [videoInput, setVideoInput] = useState("");
  const [video, setVideo] = useState<YouTubeResult | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [genieQuery, setGenieQuery] = useState("");
  const [genieResults, setGenieResults] = useState<GenieResult[]>([]);
  const [genieId, setGenieId] = useState("");
  const [lrc, setLrc] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [mergeBeforeAdd, setMergeBeforeAdd] = useState(true);
  const [translateAfter, setTranslateAfter] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const full = songCount >= maxSongs;

  const fetchLyrics = async (result: GenieResult) => {
    const response = await fetch("/api/genie/lyrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ songId: result.id }),
    });
    const data = await response.json() as { lrc?: string; error?: string };
    if (!response.ok || !data.lrc) throw new Error(data.error ?? "가사를 가져오지 못했습니다.");
    setLrc(data.lrc);
    setGenieId(result.id);
    setTitle(result.title || title);
    setArtist(result.artist || artist);
  };

  const resolveQuick = async () => {
    if (!videoInput.trim()) return;
    setBusy("quick");
    setError("");
    try {
      const videoResponse = await fetch("/api/youtube/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: videoInput.trim() }),
      });
      const resolved = await videoResponse.json() as YouTubeResult & { error?: string };
      if (!videoResponse.ok) throw new Error(resolved.error ?? "영상을 확인하지 못했습니다.");
      setVideo(resolved);
      setTitle(resolved.title);
      setArtist(resolved.artist);
      const query = `${resolved.artist} ${resolved.title}`;
      setGenieQuery(query);

      const searchResponse = await fetch("/api/genie/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const searchData = await searchResponse.json() as { results?: GenieResult[]; error?: string };
      if (!searchResponse.ok || !searchData.results?.length) {
        setAdvanced(true);
        throw new Error(searchData.error ?? "가사를 자동으로 찾지 못했습니다. 아래에서 직접 선택해주세요.");
      }
      const best = [...searchData.results].sort((a, b) => genieScore(resolved, b) - genieScore(resolved, a))[0];
      setGenieResults(searchData.results.slice(0, 5));
      await fetchLyrics(best);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "자동 추가 준비에 실패했습니다.");
    } finally {
      setBusy("");
    }
  };

  const searchGenie = async () => {
    setBusy("genie");
    setError("");
    try {
      const response = await fetch("/api/genie/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: genieQuery }),
      });
      const data = await response.json() as { results?: GenieResult[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Genie 검색에 실패했습니다.");
      setGenieResults(data.results ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Genie 검색에 실패했습니다.");
    } finally {
      setBusy("");
    }
  };

  const submit = async () => {
    setError("");
    if (full) { setError("보관함이 가득 찼습니다."); return; }
    if (!video) { setError("먼저 YouTube URL을 확인해주세요."); return; }
    const sourceLyrics = parseLrc(lrc);
    if (!sourceLyrics.length) { setError("가사를 찾거나 LRC를 붙여 넣어주세요."); return; }
    setBusy("merge");
    try {
      let lyrics = sourceLyrics;
      let originalLyrics: Song["originalLyrics"];
      if (mergeBeforeAdd && sourceLyrics.length > 1) {
        const suggestions = await requestLyricMergeSuggestions({ title: title || video.title, artist: artist || video.artist, lyrics: sourceLyrics });
        const merged = mergeLyricLines(sourceLyrics, suggestions);
        lyrics = merged.lyrics;
        if (merged.mergedGroups.length) originalLyrics = sourceLyrics.map((line) => ({ ...line }));
      }
      const now = Date.now();
      onAdd({
        id: crypto.randomUUID(),
        title: title.trim() || video.title,
        artist: artist.trim() || video.artist,
        videoId: video.videoId,
        thumbnail: video.thumbnail,
        duration: lyrics.at(-1)?.end ?? 240,
        source: genieId ? "genie" : "manual",
        genieId: genieId || undefined,
        lyrics,
        originalLyrics,
        syncOffsetMs: 0,
        createdAt: now,
        progress: { position: 0, activeLine: 0, lineProgress: {}, lastStudiedAt: now },
      }, translateAfter);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "곡 추가에 실패했습니다.");
    } finally {
      setBusy("");
    }
  };

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <div className="simple-dialog simple-add-dialog" role="dialog" aria-modal="true">
      <div className="simple-dialog-head"><div><h2>곡 추가</h2><p>YouTube 주소 하나로 시작합니다.</p></div><button onClick={onClose}><X size={19} /></button></div>
      {full ? <div className="simple-form-error"><AlertCircle size={16} /> 보관함이 가득 찼습니다 ({songCount}/{maxSongs}).</div> : null}

      <div className="simple-quick-add">
        <div className="simple-url-row"><Link2 size={17} /><input autoFocus value={videoInput} onChange={(event) => setVideoInput(event.target.value)} placeholder="YouTube URL 붙여넣기" onKeyDown={(event) => { if (event.key === "Enter") void resolveQuick(); }} /><button onClick={resolveQuick} disabled={!videoInput.trim() || Boolean(busy)}>{busy === "quick" ? <Loader2 className="spin" size={16} /> : "가져오기"}</button></div>
        {video ? <div className="simple-add-preview"><span className="simple-add-thumb" style={{ backgroundImage: `url(${video.thumbnail})` }} /><div><b>{title || video.title}</b><small>{artist || video.artist}</small><span>{lrc ? `${parseLrc(lrc).length}개 줄 · 가사 준비됨` : "가사 선택 필요"}</span></div>{lrc ? <Check size={19} /> : null}</div> : null}
      </div>

      <button className="simple-advanced-toggle" onClick={() => setAdvanced((value) => !value)}>{advanced ? "직접 설정 닫기" : "직접 설정"}</button>
      {advanced ? <div className="simple-advanced-panel">
        <div className="simple-two-fields"><label>곡명<input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>아티스트<input value={artist} onChange={(event) => setArtist(event.target.value)} /></label></div>
        <div className="simple-genie-row"><Search size={16} /><input value={genieQuery} onChange={(event) => setGenieQuery(event.target.value)} placeholder="Genie 검색" /><button onClick={searchGenie} disabled={busy === "genie"}>{busy === "genie" ? <Loader2 className="spin" size={15} /> : "찾기"}</button></div>
        {genieResults.length ? <div className="simple-genie-results">{genieResults.map((result) => <button key={result.id} onClick={() => void fetchLyrics(result)}><span><b>{result.title}</b><small>{result.artist}</small></span><em>가사 사용</em></button>)}</div> : null}
        <textarea className="simple-lrc" value={lrc} onChange={(event) => setLrc(event.target.value)} placeholder="LRC 가사를 직접 붙여 넣을 수도 있습니다." />
        <label className="simple-check"><input type="checkbox" checked={mergeBeforeAdd} onChange={(event) => setMergeBeforeAdd(event.target.checked)} /> 문장 단위 자동 정리</label>
        <label className="simple-check"><input type="checkbox" checked={translateAfter} onChange={(event) => setTranslateAfter(event.target.checked)} /> 추가 후 번역 자동 준비</label>
      </div> : null}

      {error ? <div className="simple-form-error"><AlertCircle size={16} /> {error}</div> : null}
      <div className="simple-dialog-footer"><button className="simple-secondary" onClick={onClose}>취소</button><button className="simple-primary" onClick={submit} disabled={full || !video || !lrc.trim() || Boolean(busy)}>{busy === "merge" ? <Loader2 className="spin" size={16} /> : <Plus size={16} />} 추가</button></div>
    </div>
  </div>;
}

function SettingsDialogV2({ app, onChange, onClose }: { app: PersistedState; onChange: (value: PersistedState) => void; onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const updateSettings = (partial: Partial<PersistedState["settings"]>) => onChange({ ...app, settings: { ...app.settings, ...partial } });

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify(app, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `popover-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as PersistedState;
      if (parsed.version !== 1 || !Array.isArray(parsed.songs)) throw new Error("Popover 백업 파일이 아닙니다.");
      onChange({ ...app, ...parsed, settings: { ...app.settings, ...parsed.settings } });
      window.alert("백업을 복원했습니다.");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "백업을 읽지 못했습니다.");
    }
  };

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <div className="simple-dialog simple-settings-dialog" role="dialog" aria-modal="true">
      <div className="simple-dialog-head"><div><h2>설정</h2></div><button onClick={onClose}><X size={19} /></button></div>
      <div className="simple-settings-body">
        <label className="simple-setting"><span><b>글자 크기</b><small>브라우저 확대 없이 읽기 편한 크기를 선택합니다.</small></span><select value={app.settings.fontScale} onChange={(event) => updateSettings({ fontScale: event.target.value as "normal" | "large" })}><option value="normal">기본</option><option value="large">크게</option></select></label>
        <label className="simple-setting simple-toggle"><span><b>받아쓰기 자동 반복</b><small>현재 문장을 맞힐 때까지 반복합니다.</small></span><input type="checkbox" checked={app.settings.dictationAutoRepeat} onChange={(event) => updateSettings({ dictationAutoRepeat: event.target.checked })} /></label>
        <label className="simple-setting simple-toggle"><span><b>완료 후 다음 문장</b><small>마지막 어절에서 Enter를 누르면 이동합니다.</small></span><input type="checkbox" checked={app.settings.autoAdvance} onChange={(event) => updateSettings({ autoAdvance: event.target.checked })} /></label>
        <label className="simple-setting simple-toggle"><span><b>받아쓰기 뜻 항상 표시</b><small>끄면 필요할 때만 뜻 힌트를 엽니다.</small></span><input type="checkbox" checked={app.settings.showKoreanInDictation} onChange={(event) => updateSettings({ showKoreanInDictation: event.target.checked })} /></label>
        <label className="simple-setting"><span><b>보관함 한도</b></span><select value={app.settings.maxSongs} onChange={(event) => updateSettings({ maxSongs: Number(event.target.value) })}>{[5, 8, 10, 12, 20].map((value) => <option key={value} value={value}>{value}곡</option>)}</select></label>
        <div className="simple-data-box"><div><b>학습 데이터</b><small>곡·번역·받아쓰기·저장 문장을 JSON으로 백업합니다.</small></div><div><button onClick={exportBackup}><Download size={15} /> 백업</button><button onClick={() => fileRef.current?.click()}><Upload size={15} /> 복원</button><input ref={fileRef} hidden type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importBackup(file); event.currentTarget.value = ""; }} /></div></div>
      </div>
      <div className="simple-dialog-footer"><button className="simple-primary" onClick={onClose}>완료</button></div>
    </div>
  </div>;
}

function buildTranslationPrompt(song: Song) {
  return `You are creating a high-quality Korean study translation for an English pop song.\n\nSONG\nTitle: ${song.title}\nArtist: ${song.artist}\nLine count: ${song.lyrics.length}\n\nTranslate every numbered English line into direct, intuitive Korean for English study. Preserve slang, register, repeated lines, pronouns, and context consistently. Use note only when an idiom, slang, wordplay, or cultural reference materially helps learning.\n\nReturn only valid JSON in this shape:\n{\n  "version": 1,\n  "lines": [\n    { "index": 1, "english": "exact original line", "korean": "translation", "note": null }\n  ]\n}\n\nThe lines array must contain exactly ${song.lyrics.length} items. Copy each English line verbatim.\n\nLYRICS\n${song.lyrics.map((line, index) => `${index + 1}. ${line.english}`).join("\n")}`;
}

function parseImportedTranslation(raw: string, song: Song): ImportedTranslation[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("JSON 객체를 찾지 못했습니다.");
  const parsed = JSON.parse(raw.slice(start, end + 1)) as { lines?: Array<{ index?: number; english?: string; korean?: string; note?: string | null }> };
  if (!Array.isArray(parsed.lines) || parsed.lines.length !== song.lyrics.length) throw new Error("문장 수가 현재 곡과 맞지 않습니다.");
  return song.lyrics.map((line, index) => {
    const item = parsed.lines?.find((entry, position) => (entry.index ?? position + 1) === index + 1);
    if (!item?.korean) throw new Error(`${index + 1}번 번역이 비어 있습니다.`);
    if (item.english && normalizedLineKey(item.english) !== normalizedLineKey(line.english)) throw new Error(`${index + 1}번 영어 원문이 다릅니다.`);
    return { korean: item.korean.trim(), note: item.note?.trim() || undefined };
  });
}

function TranslationImportDialogV2({ song, onClose, onApply }: { song: Song; onClose: () => void; onApply: (translated: ImportedTranslation[]) => void }) {
  const prompt = useMemo(() => buildTranslationPrompt(song), [song]);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const apply = () => {
    setError("");
    try { onApply(parseImportedTranslation(result, song)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "번역을 적용하지 못했습니다."); }
  };

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <div className="simple-dialog simple-translation-dialog" role="dialog" aria-modal="true">
      <div className="simple-dialog-head"><div><h2>번역 가져오기</h2><p>원하는 AI에서 전체 곡을 번역한 뒤 JSON만 붙여 넣습니다.</p></div><button onClick={onClose}><X size={19} /></button></div>
      <div className="simple-translation-grid">
        <section><div><b>1. 프롬프트</b><button onClick={copyPrompt}>{copied ? <Check size={14} /> : <Sparkles size={14} />} {copied ? "복사됨" : "복사"}</button></div><textarea readOnly value={prompt} /></section>
        <section><div><b>2. JSON 결과</b></div><textarea value={result} onChange={(event) => setResult(event.target.value)} placeholder={'{\n  "version": 1,\n  "lines": [...]\n}'} /></section>
      </div>
      {error ? <div className="simple-form-error"><AlertCircle size={15} /> {error}</div> : null}
      <div className="simple-dialog-footer"><button className="simple-secondary" onClick={onClose}>취소</button><button className="simple-primary" onClick={apply} disabled={!result.trim()}><Check size={15} /> 적용</button></div>
    </div>
  </div>;
}
