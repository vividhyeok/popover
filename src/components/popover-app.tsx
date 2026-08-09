"use client";

/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  Clock3,
  ExternalLink,
  Eye,
  Keyboard,
  Languages,
  Library,
  Link2,
  Loader2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatTime, normalizeAnswer, parseLrc } from "@/lib/lrc";
import { mergeLyricLines, type LyricMergeSuggestion } from "@/lib/lyric-merge";
import { defaultState, loadState, saveState } from "@/lib/storage";
import type { LineProgress, PersistedState, Song, StudyMode } from "@/lib/types";
import { YouTubePlayer, type YouTubePlayerHandle } from "./youtube-player";

type Toast = { message: string; tone?: "normal" | "error" | "success" };
type TranslationProgress = { completed: number; total: number; error?: string };
type GenieResult = { id: string; title: string; artist: string };
type YouTubeResult = { videoId: string; title: string; artist: string; thumbnail: string };
type ImportedTranslation = { korean: string; note?: string };

const EMPTY_PROGRESS: LineProgress = { draft: "", wordDrafts: [], wordResults: [], revealed: false, attempts: 0, bestScore: 0, completed: false };
const isSectionLine = (english: string) => /^\[[^\]]+\]$/.test(english.trim());
const normalizeWordAnswer = (value: string) => normalizeAnswer(value).replace(/[\s']/g, "");

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
    if (response.ok) return { suggestions: data.merges ?? [], fallback: Boolean(data.fallback) };
    lastError = data.error ?? lastError;
    if (data.code !== "UPSTREAM_TIMEOUT" || attempt === 1) break;
  }
  throw new Error(lastError);
}

export function PopoverApp() {
  const [app, setApp] = useState<PersistedState>(defaultState);
  const [hydrated, setHydrated] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [mode, setMode] = useState<StudyMode>("listen");
  const [dictationLineIndex, setDictationLineIndex] = useState<number | null>(null);
  const [loopLine, setLoopLine] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [toast, setToast] = useState<Toast | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [translationImportOpen, setTranslationImportOpen] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [mergingLyrics, setMergingLyrics] = useState(false);
  const [translationProgress, setTranslationProgress] = useState<TranslationProgress | null>(null);
  const playerRef = useRef<YouTubePlayerHandle>(null);
  const wordInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const currentTimeRef = useRef(0);

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
  const activeIndex = mode === "dictation" && dictationLineIndex !== null
    ? Math.max(0, Math.min(dictationLineIndex, (song?.lyrics.length ?? 1) - 1))
    : trackedIndex;
  const activeLine = song?.lyrics[activeIndex];
  const activeWords = useMemo(() => activeLine?.english.trim().split(/\s+/).filter(Boolean) ?? [], [activeLine?.english]);
  const activeLineIsSection = isSectionLine(activeLine?.english ?? "");
  const duration = playerDuration || song?.duration || song?.lyrics.at(-1)?.end || 0;

  useEffect(() => {
    setDictationLineIndex(mode === "dictation" ? Math.max(trackedIndex, 0) : null);
  }, [mode, song?.id]);

  const updateSong = useCallback((id: string, updater: (value: Song) => Song) => {
    setApp((state) => ({ ...state, songs: state.songs.map((item) => (item.id === id ? updater(item) : item)) }));
  }, []);

  const showToast = useCallback((message: string, tone: Toast["tone"] = "normal") => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const handlePlayerTime = useCallback((time: number, nextDuration: number) => {
    currentTimeRef.current = time;
    setCurrentTime(time);
    if (nextDuration > 0) setPlayerDuration(nextDuration);
  }, []);

  const handlePlayingChange = useCallback((value: boolean) => setPlaying(value), []);
  const handleReadyChange = useCallback((value: boolean) => setPlayerReady(value), []);

  useEffect(() => {
    if (!song) return;
    currentTimeRef.current = song.progress.position || 0;
    setCurrentTime(song.progress.position || 0);
    setPlayerDuration(song.duration || 0);
    setPlaying(false);
    setTranslationProgress(null);
  }, [song?.id]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    if (!song || song.videoId || !playing) return;
    const timer = window.setInterval(() => {
      setCurrentTime((value) => {
        const next = value + 0.1 * playbackRate;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [duration, playbackRate, playing, song?.id, song?.videoId]);

  useEffect(() => {
    if (!song || playerDuration <= 0 || Math.abs(song.duration - playerDuration) < 1) return;
    updateSong(song.id, (value) => ({ ...value, duration: playerDuration }));
  }, [playerDuration, song, updateSong]);

  useEffect(() => {
    if (!song) return;
    updateSong(song.id, (value) => {
      if (value.progress.activeLine === activeIndex) return value;
      return { ...value, progress: { ...value.progress, activeLine: activeIndex, lastStudiedAt: Date.now() } };
    });
    window.requestAnimationFrame(() => {
      if (mode !== "dictation") return;
      const line = song.lyrics[activeIndex];
      const words = line?.english.trim().split(/\s+/).filter(Boolean) ?? [];
      const results = line ? song.progress.lineProgress[line.id]?.wordResults ?? [] : [];
      const pendingIndex = words.findIndex((_, index) => results[index] !== "correct");
      wordInputRefs.current[pendingIndex >= 0 ? pendingIndex : 0]?.focus({ preventScroll: true });
    });
  }, [activeIndex, mode, song?.id, updateSong]);

  useEffect(() => {
    if (!song) return;
    const timer = window.setInterval(() => {
      updateSong(song.id, (value) => ({
        ...value,
        progress: { ...value.progress, position: currentTimeRef.current, lastStudiedAt: Date.now() },
      }));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [song?.id, updateSong]);

  const seekTo = useCallback(
    (rawSeconds: number) => {
      const target = Math.max(0, Math.min(rawSeconds, duration || rawSeconds));
      if (song?.videoId) playerRef.current?.seekTo(target);
      else setCurrentTime(target);
    },
    [duration, song?.videoId],
  );

  const seekLine = useCallback(
    (index: number) => {
      if (!song) return;
      const safeIndex = Math.max(0, Math.min(index, song.lyrics.length - 1));
      seekTo(song.lyrics[safeIndex].start - song.syncOffsetMs / 1000);
    },
    [seekTo, song],
  );

  const navigateToLine = useCallback((index: number) => {
    if (!song) return;
    const safeIndex = Math.max(0, Math.min(index, song.lyrics.length - 1));
    if (mode === "dictation") setDictationLineIndex(safeIndex);
    seekLine(safeIndex);
  }, [mode, seekLine, song]);

  const navigateStudyLine = useCallback((direction: -1 | 1) => {
    if (!song) return;
    let nextIndex = activeIndex + direction;
    while (nextIndex >= 0 && nextIndex < song.lyrics.length && isSectionLine(song.lyrics[nextIndex].english)) {
      nextIndex += direction;
    }
    if (nextIndex < 0 || nextIndex >= song.lyrics.length) return;
    navigateToLine(nextIndex);
  }, [activeIndex, navigateToLine, song]);

  const togglePlayback = useCallback(() => {
    if (!song) return;
    if (song.videoId) playerRef.current?.toggle();
    else setPlaying((value) => !value);
  }, [song]);

  useEffect(() => {
    if (!playing || !activeLine || !song) return;
    const isDictationLine = mode === "dictation" && !isSectionLine(activeLine.english);
    const lineCompleted = Boolean(song.progress.lineProgress[activeLine.id]?.completed);
    const shouldRepeat = isDictationLine ? app.settings.dictationAutoRepeat && !lineCompleted : mode === "listen" && loopLine;
    const shouldHold = isDictationLine && lineCompleted;
    if (effectiveTime < activeLine.end - 0.12) return;
    if (shouldRepeat) {
      seekLine(activeIndex);
    } else if (shouldHold) {
      if (song.videoId) playerRef.current?.pause();
      else setPlaying(false);
      seekTo(activeLine.end - song.syncOffsetMs / 1000 - 0.08);
    }
  }, [activeIndex, activeLine, app.settings.dictationAutoRepeat, effectiveTime, loopLine, mode, playing, seekLine, seekTo, song]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest(".dialog-backdrop")) return;
      if (mode === "dictation" && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        event.stopPropagation();
        navigateStudyLine(event.key === "ArrowUp" ? -1 : 1);
        return;
      }
      if (mode === "dictation" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        return;
      }
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
      } else if (mode === "listen" && event.key.toLowerCase() === "j") seekLine(activeIndex - 1);
      else if (mode === "listen" && event.key.toLowerCase() === "k") seekLine(activeIndex + 1);
      else if (mode === "listen" && event.key.toLowerCase() === "r") setLoopLine((value) => !value);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, mode, navigateStudyLine, seekLine, togglePlayback]);

  const setRate = (rate: number) => {
    setPlaybackRate(rate);
    playerRef.current?.setRate(rate);
  };

  useEffect(() => {
    if (playerReady) playerRef.current?.setRate(playbackRate);
  }, [playbackRate, playerReady, song?.id]);

  const alignFirstLyricToCurrentTime = () => {
    if (!song?.lyrics[0]) return;
    const exactPlayerTime = song.videoId && playerReady
      ? (playerRef.current?.getCurrentTime() ?? currentTimeRef.current)
      : currentTimeRef.current;
    const shiftSeconds = exactPlayerTime - song.lyrics[0].start;
    const roundTime = (seconds: number) => Math.round(seconds * 1000) / 1000;
    updateSong(song.id, (value) => ({
      ...value,
      syncOffsetMs: 0,
      lyrics: value.lyrics.map((line) => ({
        ...line,
        start: roundTime(line.start + shiftSeconds),
        end: roundTime(line.end + shiftSeconds),
      })),
    }));
    const shiftLabel = `${shiftSeconds >= 0 ? "+" : ""}${shiftSeconds.toFixed(1)}초`;
    showToast(`첫 가사를 ${formatTime(exactPlayerTime)}로 지정하고 모든 가사를 ${shiftLabel} 이동했습니다.`, "success");
  };

  const offsetSeconds = (song?.syncOffsetMs ?? 0) / 1000;
  const firstLyricVideoTime = song?.lyrics[0] ? Math.max(0, song.lyrics[0].start - offsetSeconds) : 0;

  const activeProgress = activeLine
    ? song?.progress.lineProgress[activeLine.id] ?? EMPTY_PROGRESS
    : EMPTY_PROGRESS;
  const revealed = Boolean(activeProgress.revealed);

  const focusWord = (wordIndex: number) => {
    if (wordIndex < 0 || wordIndex >= activeWords.length) return;
    window.requestAnimationFrame(() => {
      const input = wordInputRefs.current[wordIndex];
      input?.focus({ preventScroll: true });
      input?.select();
    });
  };

  const focusNextPendingWord = (wordIndex: number) => {
    const results = activeProgress.wordResults ?? [];
    for (let index = wordIndex + 1; index < activeWords.length; index += 1) {
      if (results[index] !== "correct") {
        focusWord(index);
        return;
      }
    }
    for (let index = 0; index < wordIndex; index += 1) {
      if (results[index] !== "correct") {
        focusWord(index);
        return;
      }
    }
  };

  const setWordDraft = (wordIndex: number, draft: string) => {
    if (!song || !activeLine) return;
    updateSong(song.id, (value) => ({
      ...value,
      progress: {
        ...value.progress,
        lineProgress: {
          ...value.progress.lineProgress,
          [activeLine.id]: (() => {
            const before = value.progress.lineProgress[activeLine.id] ?? EMPTY_PROGRESS;
            const wordDrafts = [...(before.wordDrafts ?? [])];
            const wordResults = [...(before.wordResults ?? [])];
            wordDrafts[wordIndex] = draft;
            wordResults[wordIndex] = revealed ? "wrong" : null;
            return { ...before, wordDrafts, wordResults };
          })(),
        },
      },
    }));
  };

  const deferWord = (wordIndex: number) => {
    if (!song || !activeLine || revealed) return;
    updateSong(song.id, (value) => {
      const before = value.progress.lineProgress[activeLine.id] ?? EMPTY_PROGRESS;
      const wordResults = [...(before.wordResults ?? [])];
      if (wordResults[wordIndex] !== "correct") wordResults[wordIndex] = "skipped";
      return {
        ...value,
        progress: {
          ...value.progress,
          lineProgress: {
            ...value.progress.lineProgress,
            [activeLine.id]: { ...before, wordResults },
          },
        },
      };
    });
    focusNextPendingWord(wordIndex);
  };

  const checkWord = (wordIndex: number, currentDraft?: string) => {
    if (!song || !activeLine) return;
    const draft = currentDraft?.trim() ?? activeProgress.wordDrafts?.[wordIndex]?.trim() ?? "";
    if (!draft) return;
    const correct = !revealed && normalizeWordAnswer(draft) === normalizeWordAnswer(activeWords[wordIndex] ?? "");
    const nextResults = [...(activeProgress.wordResults ?? [])];
    nextResults[wordIndex] = correct ? "correct" : "wrong";
    const correctCount = activeWords.filter((_, index) => nextResults[index] === "correct").length;
    const score = activeWords.length ? Math.round((correctCount / activeWords.length) * 100) : 0;
    const completed = activeWords.length > 0 && correctCount === activeWords.length;
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
    if (!correct) return;
    const nextWordIndex = activeWords.findIndex((_, index) => index > wordIndex && nextResults[index] !== "correct");
    if (nextWordIndex >= 0) focusWord(nextWordIndex);
    if (completed) showToast("문장 완료 · 위·아래 버튼이나 오른쪽 목록으로 이동하세요.", "success");
  };

  const revealAnswer = () => {
    if (!song || !activeLine || revealed) return;
    updateSong(song.id, (value) => {
      const before = value.progress.lineProgress[activeLine.id] ?? EMPTY_PROGRESS;
      const wordDrafts = before.wordDrafts ?? [];
      const wordResults = activeWords.map((word, index) => {
        if (before.wordResults?.[index] === "correct") return "correct" as const;
        const draft = wordDrafts[index]?.trim() ?? "";
        return draft && normalizeWordAnswer(draft) === normalizeWordAnswer(word) ? "correct" as const : "wrong" as const;
      });
      const correctCount = wordResults.filter((result) => result === "correct").length;
      const score = activeWords.length ? Math.round((correctCount / activeWords.length) * 100) : 0;
      const completed = activeWords.length > 0 && correctCount === activeWords.length;
      return {
        ...value,
        progress: {
          ...value.progress,
          lineProgress: {
            ...value.progress.lineProgress,
            [activeLine.id]: {
              ...before,
              wordResults,
              revealed: true,
              attempts: before.attempts + 1,
              bestScore: Math.max(before.bestScore, score),
              completed: before.completed || completed,
            },
          },
        },
      };
    });
  };

  const mergeCurrentSongLyrics = async () => {
    if (!song || mergingLyrics) return;
    setMergingLyrics(true);
    showToast("DeepSeek가 문맥상 불필요한 가사 경계를 찾고 있습니다.");
    try {
      const plan = await requestLyricMergeSuggestions(song);
      const { lyrics, mergedGroups } = mergeLyricLines(song.lyrics, plan.suggestions);
      if (!mergedGroups.length) {
        showToast("합칠 필요가 확실한 가사 경계를 찾지 못했습니다.", "success");
        return;
      }

      const preview = mergedGroups.slice(0, 5).map((group) =>
        group.sourceIndexes.map((index) => song.lyrics[index].english).join(" / "),
      ).join("\n");
      const removedCount = song.lyrics.length - lyrics.length;
      const more = mergedGroups.length > 5 ? `\n외 ${mergedGroups.length - 5}개 묶음` : "";
      if (!window.confirm(`${removedCount}개의 불필요한 줄 경계를 합칠까요?\n\n${preview}${more}\n\n병합되는 줄의 기존 받아쓰기 기록만 초기화됩니다.`)) return;

      const affectedIds = new Set(mergedGroups.flatMap((group) => group.sourceIds));
      const currentLineId = song.lyrics[activeIndex]?.id;
      const currentGroup = mergedGroups.find((group) => currentLineId && group.sourceIds.includes(currentLineId));
      const nextActiveId = currentGroup?.sourceIds[0] ?? currentLineId;
      const nextActiveIndex = Math.max(0, lyrics.findIndex((line) => line.id === nextActiveId));
      updateSong(song.id, (value) => ({
        ...value,
        lyrics,
        progress: {
          ...value.progress,
          activeLine: nextActiveIndex,
          lineProgress: Object.fromEntries(
            Object.entries(value.progress.lineProgress).filter(([lineId]) => !affectedIds.has(lineId)),
          ),
          lastStudiedAt: Date.now(),
        },
      }));
      if (mode === "dictation") setDictationLineIndex(nextActiveIndex);
      showToast(`${removedCount}개 줄 경계를 합쳤습니다.${plan.fallback ? " · DeepSeek 지연으로 안전 규칙을 사용했습니다." : ""}`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "가사 구조 분석에 실패했습니다.", "error");
    } finally {
      setMergingLyrics(false);
    }
  };

  const removeSong = (id: string) => {
    const target = app.songs.find((item) => item.id === id);
    if (!target || !window.confirm(`“${target.title}”을 보관함에서 삭제할까요? 학습 기록도 함께 삭제됩니다.`)) return;
    setApp((state) => {
      const songs = state.songs.filter((item) => item.id !== id);
      const fallback = songs[0]?.id ?? "";
      return { ...state, songs, selectedSongId: state.selectedSongId === id ? fallback : state.selectedSongId };
    });
    showToast("곡과 학습 기록을 삭제했습니다.");
  };

  const translateSong = async (target: Song) => {
    const alreadyTranslated = target.lyrics.length > 0 && target.lyrics.every((line) => Boolean(line.korean));
    if (alreadyTranslated && !window.confirm("저장된 전체 번역이 있습니다. DeepSeek로 다시 번역해 덮어쓸까요?")) return;

    const total = target.lyrics.length;
    const batchSize = 8;
    const workingTranslations: Array<string | null> = target.lyrics.map((line) => line.korean ?? null);
    const workingNotes: Array<string | null> = target.lyrics.map((line) => line.note ?? null);

    if (alreadyTranslated) {
      workingTranslations.fill(null);
      workingNotes.fill(null);
      updateSong(target.id, (value) => ({
        ...value,
        lyrics: value.lyrics.map((line) => ({ ...line, korean: undefined, note: undefined })),
      }));
    }

    let startIndex = workingTranslations.findIndex((translation) => !translation);
    if (startIndex < 0) startIndex = 0;
    const initiallyCompleted = workingTranslations.filter(Boolean).length;
    setTranslating(true);
    setTranslationProgress({ completed: initiallyCompleted, total });
    showToast(`곡 전체 문맥을 유지하면서 ${batchSize}줄씩 번역합니다.`);

    try {
      let mood = "";
      for (let batchStart = startIndex; batchStart < total; batchStart += batchSize) {
        const batchEnd = Math.min(batchStart + batchSize, total);
        let data: { translations: string[]; studyNotes?: Array<string | null>; mood?: string; error?: string; code?: string } | null = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const response = await fetch("/api/translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: target.title,
              artist: target.artist,
              lyrics: target.lyrics.map((line) => line.english),
              startIndex: batchStart,
              endIndex: batchEnd,
              existingTranslations: workingTranslations,
              existingNotes: workingNotes,
            }),
          });
          const result = await response.json();
          if (response.ok) {
            data = result;
            break;
          }
          const retryable = result.code === "UPSTREAM_TIMEOUT" || result.code === "PARTIAL_BATCH";
          if (!retryable || attempt === 2) throw new Error(result.error ?? "번역 요청에 실패했습니다.");
          setTranslationProgress({ completed: workingTranslations.filter(Boolean).length, total });
          showToast(`${batchStart + 1}~${batchEnd}줄 새 요청 재시도 ${attempt + 1}/2`);
          await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
        }
        if (!data) throw new Error("번역 응답을 받지 못했습니다.");

        data.translations.forEach((translation: string, index: number) => {
          workingTranslations[batchStart + index] = translation;
          workingNotes[batchStart + index] = data.studyNotes?.[index] || null;
        });
        mood ||= data.mood ?? "";

        updateSong(target.id, (value) => ({
          ...value,
          lyrics: value.lyrics.map((line, index) => ({
            ...line,
            korean: workingTranslations[index] ?? line.korean,
            note: workingNotes[index] ?? undefined,
          })),
        }));
        setTranslationProgress({ completed: workingTranslations.filter(Boolean).length, total });
      }
      showToast(mood ? `번역 완료 · ${mood}` : "곡 전체 맥락 번역을 완료했습니다.", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "번역에 실패했습니다.";
      setTranslationProgress({ completed: workingTranslations.filter(Boolean).length, total, error: message });
      showToast(message, "error");
    } finally {
      setTranslating(false);
    }
  };

  const addSong = (nextSong: Song, translateAfter: boolean) => {
    if (app.songs.length >= app.settings.maxSongs) {
      showToast(`보관함이 가득 찼습니다. 기존 곡을 삭제하거나 저장 한도를 늘려주세요.`, "error");
      return false;
    }
    setApp((state) => ({ ...state, songs: [nextSong, ...state.songs], selectedSongId: nextSong.id }));
    setAddOpen(false);
    showToast("새 곡을 보관함에 저장했습니다.", "success");
    if (translateAfter) void translateSong(nextSong);
    return true;
  };

  const studyLineCount = song?.lyrics.filter((line) => !isSectionLine(line.english)).length ?? 0;
  const completedCount = song
    ? song.lyrics.filter((line) => !isSectionLine(line.english) && song.progress.lineProgress[line.id]?.completed).length
    : 0;
  const activeWordsCompleted = activeWords.length > 0 && activeWords.every((_, index) => activeProgress.wordResults?.[index] === "correct");

  if (!hydrated) return <div className="app-loading">Popover를 준비하고 있습니다…</div>;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><span /></div>
          <div><strong>popover</strong><small>POP SONG STUDY DESK</small></div>
        </div>
        <div className="study-view-nav" aria-label="학습 화면 선택">
          <button className={mode === "listen" ? "active" : ""} onClick={() => setMode("listen")}>
            <Languages size={16} /><span><b>듣기 학습</b><small>가사 이해·트래킹</small></span>
          </button>
          <button className={mode === "dictation" ? "active" : ""} onClick={() => setMode("dictation")}>
            <Keyboard size={16} /><span><b>받아쓰기 연습</b><small>듣고 바로 입력</small></span>
          </button>
        </div>
        <div className="top-actions">
          <button className="ghost-button" onClick={() => setSettingsOpen(true)}><Settings2 size={16} /> 설정</button>
          <button className="primary-button" onClick={() => setAddOpen(true)}><Plus size={17} /> 곡 추가</button>
        </div>
      </header>

      <div className={`workspace ${mode === "dictation" ? "dictation-workspace" : "listen-workspace"}`}>
        <aside className="library-panel">
          <div className="panel-title-row">
            <div><p className="eyebrow">MY LIBRARY</p><h2>학습 곡</h2></div>
            <span className="capacity-badge">{app.songs.length} / {app.settings.maxSongs}</span>
          </div>
          <button className="add-song-rail" onClick={() => setAddOpen(true)}><Plus size={16} /> 새 곡 등록</button>
          <div className="song-list">
            {app.songs.map((item) => {
              const studyLines = item.lyrics.filter((line) => !isSectionLine(line.english));
              const mastered = studyLines.filter((line) => item.progress.lineProgress[line.id]?.completed).length;
              const percentage = studyLines.length ? Math.round((mastered / studyLines.length) * 100) : 0;
              return (
                <div className={item.id === song?.id ? "song-card active" : "song-card"} key={item.id}>
                  <button className="song-select" onClick={() => setApp((state) => ({ ...state, selectedSongId: item.id }))}>
                    <span className="song-cover" style={{ backgroundImage: `url(${item.thumbnail})` }} />
                    <span className="song-copy"><b>{item.title}</b><small>{item.artist}</small><span className="micro-progress"><i style={{ width: `${percentage}%` }} /></span></span>
                  </button>
                  <button className="icon-button delete-song" aria-label={`${item.title} 삭제`} onClick={() => removeSong(item.id)}><Trash2 size={14} /></button>
                </div>
              );
            })}
            {app.songs.length === 0 ? (
              <div className="empty-library"><Library size={28} /><b>보관함이 비어 있어요</b><p>YouTube 영상과 LRC 가사를 등록해보세요.</p></div>
            ) : null}
          </div>
          <div className="library-footnote">
            <span><CircleCheck size={14} /> 브라우저에 자동 저장</span>
            <p>영상 파일은 저장하지 않아 용량을 아낍니다.</p>
          </div>
        </aside>

        <section className={`player-column ${mode === "dictation" ? "dictation-column" : "listening-column"}`}>
          {song ? (
            <>
              <div className="player-heading">
                <div><p className="eyebrow">{mode === "dictation" ? "DICTATION PRACTICE" : "LISTENING STUDY"}</p><h1>{song.title}</h1><p>{song.artist}</p></div>
                <div className="player-heading-actions">
                  <button className="lyric-merge-button" onClick={mergeCurrentSongLyrics} disabled={mergingLyrics || song.lyrics.length < 2} title="노래방 표시용으로 잘린 가사를 문장 단위로 다시 묶습니다.">{mergingLyrics ? <Loader2 className="spin" size={14} /> : <Link2 size={14} />}{mergingLyrics ? "문장 분석 중" : "DeepSeek 문장 합치기"}</button>
                  {song.videoId ? <a className="youtube-link" href={`https://youtu.be/${song.videoId}`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> YouTube</a> : <span className="demo-chip">DEMO</span>}
                </div>
              </div>

              <div className={`video-stage ${mode === "dictation" ? "dictation-video-stage" : ""}`}>
                {song.videoId ? (
                  <YouTubePlayer
                    key={`${song.id}-${song.videoId}`}
                    ref={playerRef}
                    videoId={song.videoId}
                    initialTime={song.progress.position}
                    onTime={handlePlayerTime}
                    onPlayingChange={handlePlayingChange}
                    onReadyChange={handleReadyChange}
                  />
                ) : (
                  <div className="demo-stage" style={{ backgroundImage: `url(${song.thumbnail})` }}>
                    <div className="demo-stage-shade" />
                    <div className="demo-stage-copy"><Sparkles size={20} /><b>인터랙션 데모</b><p>등록한 YouTube 영상은 이 자리에 표시됩니다.</p></div>
                  </div>
                )}
              </div>

              {mode === "listen" ? (
                <>
                  <div className="focus-line-card listening-focus">
                    <div className="focus-line-meta"><span>{activeLine ? `LINE ${String(activeIndex + 1).padStart(2, "0")}` : "WAITING"}</span><span>{activeLine ? formatTime(activeLine.start) : `첫 가사 ${formatTime(firstLyricVideoTime)}`}</span></div>
                    <p className="focus-english">{activeLine?.english ?? "첫 가사를 기다리는 중"}</p>
                    <p className="focus-korean">{activeLine?.korean ?? (song.lyrics.length ? `${formatTime(firstLyricVideoTime)}부터 문장 트래킹을 시작합니다.` : "번역을 가져오면 한국어 의미가 표시됩니다.")}</p>
                    <div className="focus-note-slot">
                      {activeLine?.note ? <div className="focus-note open"><b>STUDY NOTE</b><p>{activeLine.note}</p></div> : <div className="focus-note empty"><b>STUDY NOTE</b><p>이 문장에는 추가 학습 메모가 없습니다.</p></div>}
                    </div>
                  </div>

                  <div className="transport-card listening-transport">
                    <div className="timeline-row">
                      <span>{formatTime(currentTime)}</span>
                      <input aria-label="재생 위치" type="range" min={0} max={Math.max(duration, 1)} step={0.1} value={Math.min(currentTime, duration || 0)} onChange={(event) => seekTo(Number(event.target.value))} />
                      <span>{formatTime(duration)}</span>
                    </div>
                    <div className="primary-controls">
                      <button className="round-control" aria-label="이전 문장" onClick={() => navigateToLine(activeIndex - 1)}><ChevronLeft size={23} /></button>
                      <button className="play-control" aria-label={playing ? "일시정지" : "재생"} onClick={togglePlayback}>{playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}</button>
                      <button className="round-control" aria-label="다음 문장" onClick={() => navigateToLine(activeIndex + 1)}><ChevronRight size={23} /></button>
                    </div>
                    <div className="utility-controls">
                      <button className={loopLine ? "utility-button active" : "utility-button"} onClick={() => setLoopLine((value) => !value)}><RotateCcw size={15} /> 문장 반복</button>
                      <label className="rate-control"><span>속도</span><select value={playbackRate} onChange={(event) => setRate(Number(event.target.value))}><option value={0.75}>0.75×</option><option value={1}>1.0×</option><option value={1.25}>1.25×</option><option value={1.5}>1.5×</option></select></label>
                      <span className={song.videoId && !playerReady ? "ready-state pending" : "ready-state"}>{song.videoId && !playerReady ? "플레이어 연결 중" : "준비됨"}</span>
                    </div>
                  </div>

                  <div className="sync-card compact">
                    <div className="sync-title"><Clock3 size={16} /><div><b>첫 가사 시작 · {formatTime(firstLyricVideoTime)}</b><small>영상에서 첫 가사가 들리는 순간에 아래 버튼을 누르세요.</small></div></div>
                    <button className="stamp-button" onClick={alignFirstLyricToCurrentTime}>현재 시점을 첫 가사 시작으로 지정</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="dictation-practice-card">
                    <div className="dictation-line-head">
                      <div><span>현재 연습 문장</span><b>{activeLine ? `LINE ${String(activeIndex + 1).padStart(2, "0")}` : "WAITING"}</b></div>
                      <div className="dictation-line-score"><b>{activeProgress.wordResults?.filter((result) => result === "correct").length ?? 0}</b><span>/ {activeWords.length} 어절</span></div>
                    </div>
                    <div className="dictation-prompt">
                      <span>KOREAN PROMPT</span>
                      <p>{activeLine?.korean ?? "한국어 뜻을 준비하고 있습니다."}</p>
                    </div>

                    {activeLine ? activeLineIsSection ? (
                      <div className="section-line-skip"><span>구간 표시입니다. <kbd>↑</kbd> 또는 <kbd>↓</kbd>로 실제 가사 문장으로 이동하세요.</span></div>
                    ) : (
                      <div className="word-practice typing-practice">
                        <div className="word-practice-head">
                          <div><b>들리는 순서대로 입력</b><span>빈칸에서 Space를 누르면 보류</span></div>
                          <button className="reveal-answer-button" onClick={revealAnswer} disabled={revealed}><Eye size={14} />{revealed ? "정답 공개됨" : "정답 보기"}</button>
                        </div>
                        <div className="word-flow" aria-label="문장 어절별 입력">
                          {activeWords.map((word, wordIndex) => {
                            const result = activeProgress.wordResults?.[wordIndex] ?? null;
                            const wordWidth = Math.max(3, Math.min(normalizeWordAnswer(word).length, 18));
                            return (
                              <div className={`word-token ${result ?? ""}`} key={`${activeLine.id}-${wordIndex}`} style={{ width: `calc(${wordWidth}ch + 18px)` }}>
                                <span className="word-token-label">{revealed ? word : String(wordIndex + 1).padStart(2, "0")}</span>
                                <span className="word-input-wrap">
                                  <input
                                    ref={(element) => { wordInputRefs.current[wordIndex] = element; }}
                                    aria-label={`${wordIndex + 1}번째 어절`}
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={revealed && result === "wrong" ? word : (activeProgress.wordDrafts?.[wordIndex] ?? "")}
                                    placeholder="…"
                                    readOnly={revealed}
                                    onFocus={(event) => event.currentTarget.select()}
                                    onChange={(event) => setWordDraft(wordIndex, event.target.value)}
                                    onKeyDown={(event) => {
                                      if (event.nativeEvent.isComposing) return;
                                      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "Enter"].includes(event.key) || event.code === "Space") {
                                        event.preventDefault();
                                        event.stopPropagation();
                                      }
                                      if (event.key === "ArrowLeft") focusWord(wordIndex - 1);
                                      else if (event.key === "ArrowRight") focusWord(wordIndex + 1);
                                      else if (event.key === "ArrowUp") navigateStudyLine(-1);
                                      else if (event.key === "ArrowDown") navigateStudyLine(1);
                                      else if ((event.code === "Space" || event.key === "Enter") && !activeWordsCompleted && !revealed) {
                                        const draft = event.currentTarget.value.trim();
                                        if (draft) checkWord(wordIndex, draft);
                                        else deferWord(wordIndex);
                                      }
                                    }}
                                  />
                                </span>
                                <small aria-live="polite">{result === "correct" ? "정답" : result === "wrong" ? "오답" : result === "skipped" ? "보류" : ""}</small>
                              </div>
                            );
                          })}
                        </div>
                        <div className={`word-practice-foot ${activeWordsCompleted ? "ready-next" : ""}`}>
                          <span>{activeWordsCompleted ? "문장 완료 · ↓로 다음 가사 이동" : "미완료 문장은 현재 구간을 계속 반복합니다."}</span>
                          <span>시도 {activeProgress.attempts}회 · 최고 {activeProgress.bestScore}%</span>
                        </div>
                      </div>
                    ) : <div className="dictation-waiting">첫 가사 구간으로 이동하면 입력이 시작됩니다.</div>}

                    <div className="dictation-note-slot">
                      {activeLine?.note ? <details className="focus-note"><summary>STUDY NOTE <span>필요할 때만 열기</span></summary><p>{activeLine.note}</p></details> : <div className="focus-note empty"><b>STUDY NOTE</b><p>이 문장에는 추가 학습 메모가 없습니다.</p></div>}
                    </div>
                  </div>

                  <div className="dictation-transport">
                    <button className="dictation-nav-button" onClick={() => navigateStudyLine(-1)}><ChevronUp size={20} /><span><small>↑</small> 이전 가사</span></button>
                    <div className="dictation-playback">
                      <button aria-label="현재 문장 처음부터 듣기" onClick={() => seekLine(activeIndex)}><RotateCcw size={17} /></button>
                      <button className="dictation-play-button" aria-label={playing ? "일시정지" : "재생"} onClick={togglePlayback}>{playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</button>
                      <label><span>속도</span><select value={playbackRate} onChange={(event) => setRate(Number(event.target.value))}><option value={0.75}>0.75×</option><option value={1}>1.0×</option><option value={1.25}>1.25×</option><option value={1.5}>1.5×</option></select></label>
                      <button className={app.settings.dictationAutoRepeat ? "dictation-repeat-toggle active" : "dictation-repeat-toggle"} onClick={() => setApp((state) => ({ ...state, settings: { ...state.settings, dictationAutoRepeat: !state.settings.dictationAutoRepeat } }))}><RotateCcw size={14} /> 자동 반복 {app.settings.dictationAutoRepeat ? "켬" : "끔"}</button>
                    </div>
                    <button className="dictation-nav-button" onClick={() => navigateStudyLine(1)}><ChevronDown size={20} /><span><small>↓</small> 다음 가사</span></button>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="no-song"><Library size={36} /><h2>학습할 곡을 등록해주세요</h2><button className="primary-button" onClick={() => setAddOpen(true)}><Plus size={16} /> 곡 추가</button></div>
          )}
        </section>

        <section className="lyrics-panel">
          <div className="lyrics-toolbar">
            <div className="lyrics-toolbar-copy"><p className="eyebrow">{mode === "dictation" ? "PRACTICE QUEUE" : "LYRIC TRACKER"}</p><h2>{mode === "dictation" ? "연습 문장" : "문장 트래킹"}</h2><small>{mode === "dictation" ? "한국어 뜻만 보고 원하는 줄로 이동" : "재생 위치에 맞춰 원문과 번역 확인"}</small></div>
            <div className="toolbar-actions">
              <button className="translate-button" disabled={!song} onClick={() => setTranslationImportOpen(true)}><Sparkles size={15} /> AI 번역 가져오기</button>
            </div>
          </div>
          {translationProgress ? <div className={translationProgress.error ? "translation-status error" : "translation-status"}>{translationProgress.error ? <><AlertCircle size={14} /><span><b>{translationProgress.completed}/{translationProgress.total}줄까지 저장됨</b> · {translationProgress.error} 다시 누르면 이어서 번역합니다.</span></> : translating ? <><Loader2 className="spin" size={14} /><span><b>{translationProgress.completed}/{translationProgress.total}줄 번역 완료</b> · 받은 문장부터 바로 저장하고 있습니다.</span></> : null}</div> : <div className="translation-status" />}
          <div className="progress-strip"><span><b>{completedCount}</b> / {studyLineCount} 문장 완료</span><div><i style={{ width: `${studyLineCount ? (completedCount / studyLineCount) * 100 : 0}%` }} /></div></div>

          <div className="lyrics-scroll">
            {song?.lyrics.map((line, index) => {
              const progress = song.progress.lineProgress[line.id];
              const isActive = index === activeIndex;
              return (
                <button className={`${isActive ? "lyric-row active" : "lyric-row"} ${mode === "dictation" ? "dictation-row" : ""}`} key={line.id} onClick={() => navigateToLine(index)} aria-current={isActive ? "true" : undefined}>
                  <span className="line-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="line-body">
                    {mode === "listen" ? <span className="line-english">{line.english}</span> : null}
                    <span className="line-korean">{line.korean || "번역 대기 중"}</span>
                  </span>
                  <span className="line-status">{progress?.completed ? <Check size={15} /> : mode === "dictation" && progress?.revealed ? "공개" : mode === "dictation" && progress?.wordResults?.includes("skipped") ? "보류" : formatTime(line.start)}</span>
                </button>
              );
            })}
          </div>

          {mode === "listen" ? (
            <div className="shortcut-bar"><Keyboard size={15} /><span><kbd>Space</kbd> 재생</span><span><kbd>J</kbd>/<kbd>K</kbd> 문장 이동</span><span><kbd>R</kbd> 반복</span></div>
          ) : (
            <div className="shortcut-bar dictation-shortcuts"><Keyboard size={15} /><span><kbd>Space</kbd> 채점·보류</span><span><kbd>←</kbd>/<kbd>→</kbd> 어절</span><span><kbd>↑</kbd>/<kbd>↓</kbd> 가사</span><em>화살표는 재생 위치나 목록 스크롤을 바꾸지 않습니다</em></div>
          )}
        </section>
      </div>

      {addOpen ? <AddSongDialog onClose={() => setAddOpen(false)} onAdd={addSong} songCount={app.songs.length} maxSongs={app.settings.maxSongs} onManage={() => { setAddOpen(false); setSettingsOpen(true); }} /> : null}
      {settingsOpen ? <SettingsDialog app={app} onChange={setApp} onClose={() => setSettingsOpen(false)} /> : null}
      {translationImportOpen && song ? <TranslationImportDialog song={song} onClose={() => setTranslationImportOpen(false)} onApply={(translated) => { updateSong(song.id, (value) => ({ ...value, lyrics: value.lyrics.map((line, index) => ({ ...line, korean: translated[index].korean, note: translated[index].note })) })); setTranslationImportOpen(false); showToast(`${translated.length}개 문장의 번역과 NOTE를 적용했습니다.`, "success"); }} /> : null}
      {toast ? <div className={`toast ${toast.tone ?? "normal"}`}>{toast.tone === "error" ? <AlertCircle size={17} /> : toast.tone === "success" ? <CircleCheck size={17} /> : null}{toast.message}</div> : null}
    </main>
  );
}

function buildTranslationPrompt(song: Song) {
  return `You are creating a high-quality Korean study translation for an English pop song.

SONG
Title: ${song.title}
Artist: ${song.artist}
Line count: ${song.lyrics.length}

TRANSLATION CONTRACT
1. Read the entire song before translating. Keep the speaker, addressee, narrative, emotion, recurring imagery, pronouns, and terminology coherent across all lines.
2. Preserve an exact 1:1 mapping: one JSON line object for every numbered English line. Never merge, split, omit, add, or reorder lines.
3. Translate identical repeated English lines identically. Keep near-repeated hooks and motifs terminologically consistent unless the meaning genuinely changes.
4. Write direct, intuitive Korean that a learner can map back to the English. Use context for accuracy, but do not create a poetic rewrite or add meaning absent from the original.
5. Preserve the intent and register of slang, contractions, profanity, dialect, deliberate nonstandard grammar, spelling, and wordplay. Do not silently correct the English.
6. Use note only when slang, an idiom, deliberate grammar, wordplay, or a cultural reference materially helps English study. The note must be one short Korean sentence. Otherwise use null.
7. Copy each supplied English line into the english field verbatim so the importing app can verify alignment.
8. Return only one valid JSON object. Do not use Markdown, code fences, introductions, or explanations outside JSON.

REQUIRED JSON SHAPE
{
  "version": 1,
  "song": { "title": ${JSON.stringify(song.title)}, "artist": ${JSON.stringify(song.artist)} },
  "mood": "곡 전체 분위기를 나타내는 짧은 한국어 구절",
  "lines": [
    { "index": 1, "english": "exact original line", "korean": "학습용 한국어 번역", "note": null }
  ]
}

The lines array must contain exactly ${song.lyrics.length} objects with consecutive indexes 1 through ${song.lyrics.length}.

LYRICS
${song.lyrics.map((line, index) => `${index + 1}. ${line.english}`).join("\n")}`;
}

class TranslationJsonSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationJsonSyntaxError";
  }
}

function parseImportedTranslation(raw: string, song: Song): ImportedTranslation[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new TranslationJsonSyntaxError("JSON 객체를 찾지 못했습니다.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new TranslationJsonSyntaxError("JSON 문법을 읽을 수 없습니다.");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("올바른 JSON 객체가 아닙니다.");

  const object = parsed as {
    lines?: unknown[];
    translations?: unknown[];
    studyNotes?: unknown[];
  };
  const source = Array.isArray(object.lines) ? object.lines : object.translations;
  if (!Array.isArray(source)) throw new Error("JSON에 lines 배열이 없습니다.");
  if (source.length !== song.lyrics.length) {
    throw new Error(`문장 수가 맞지 않습니다. 현재 곡 ${song.lyrics.length}줄, JSON ${source.length}줄입니다.`);
  }

  const byIndex = new Map<number, ImportedTranslation>();
  source.forEach((entry, position) => {
    if (typeof entry === "string") {
      const note = object.studyNotes?.[position];
      byIndex.set(position, { korean: entry.trim(), note: typeof note === "string" && note.trim() ? note.trim() : undefined });
      return;
    }
    if (!entry || typeof entry !== "object") throw new Error(`${position + 1}번 번역 항목이 객체가 아닙니다.`);
    const item = entry as { index?: unknown; english?: unknown; korean?: unknown; translation?: unknown; note?: unknown; studyNote?: unknown };
    const index = Number(item.index ?? position + 1) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= song.lyrics.length || byIndex.has(index)) {
      throw new Error(`${position + 1}번째 항목의 index가 잘못됐거나 중복됐습니다.`);
    }
    if (typeof item.english === "string") {
      const expected = song.lyrics[index].english.replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
      const received = item.english.replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
      if (expected !== received) throw new Error(`${index + 1}번 영어 원문이 현재 곡과 다릅니다.`);
    }
    const korean = typeof item.korean === "string" ? item.korean : item.translation;
    if (typeof korean !== "string" || !korean.trim()) throw new Error(`${index + 1}번 한국어 번역이 비어 있습니다.`);
    const rawNote = item.note ?? item.studyNote;
    byIndex.set(index, { korean: korean.trim(), note: typeof rawNote === "string" && rawNote.trim() ? rawNote.trim() : undefined });
  });

  const canonical = new Map<string, ImportedTranslation>();
  return song.lyrics.map((line, index) => {
    const imported = byIndex.get(index);
    if (!imported) throw new Error(`${index + 1}번 번역을 찾지 못했습니다.`);
    const key = line.english.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
    const repeated = canonical.get(key);
    if (repeated) return repeated;
    canonical.set(key, imported);
    return imported;
  });
}

function TranslationImportDialog({ song, onClose, onApply }: { song: Song; onClose: () => void; onApply: (translated: ImportedTranslation[]) => void }) {
  const prompt = useMemo(() => buildTranslationPrompt(song), [song]);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [repairing, setRepairing] = useState(false);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("클립보드에 복사하지 못했습니다. 프롬프트 영역에서 Ctrl+A, Ctrl+C를 사용해주세요.");
    }
  };

  const apply = async () => {
    setError("");
    try {
      onApply(parseImportedTranslation(result, song));
    } catch (caught) {
      if (!(caught instanceof TranslationJsonSyntaxError)) {
        setError(caught instanceof Error ? caught.message : "번역 JSON을 적용하지 못했습니다.");
        return;
      }

      setRepairing(true);
      try {
        const response = await fetch("/api/translate/repair", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ raw: result, expectedLineCount: song.lyrics.length }),
        });
        const data = await response.json() as { repaired?: string; error?: string };
        if (!response.ok || !data.repaired) throw new Error(data.error ?? "JSON 문법을 자동 수정하지 못했습니다.");
        setResult(data.repaired);
        try {
          const translated = parseImportedTranslation(data.repaired, song);
          setRepairing(false);
          onApply(translated);
        } catch (validationError) {
          throw new Error(`JSON 문법은 자동 수정했지만 내용 검증에 실패했습니다. ${validationError instanceof Error ? validationError.message : "결과를 확인해주세요."}`);
        }
      } catch (repairError) {
        setError(repairError instanceof Error ? repairError.message : "JSON 문법을 자동 수정하지 못했습니다.");
        setRepairing(false);
      }
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (!repairing && event.currentTarget === event.target) onClose(); }}>
      <div className="dialog-card translation-import-dialog" role="dialog" aria-modal="true" aria-label="AI 번역 가져오기">
        <div className="dialog-header"><div><p className="eyebrow">MODEL-INDEPENDENT TRANSLATION</p><h2>AI 번역 가져오기</h2><p>Claude, GPT 등 원하는 모델에서 전체 곡을 충분히 검토한 결과를 가져옵니다.</p></div><button className="icon-button" onClick={onClose} disabled={repairing}><X size={19} /></button></div>
        <div className="translation-import-body">
          <section className="translation-step"><div className="translation-step-head"><span>1</span><div><h3>전체 가사 프롬프트 복사</h3><p>번역 원칙과 정확한 JSON 형식이 포함되어 있습니다.</p></div><button className="copy-prompt-button" onClick={copyPrompt}>{copied ? <Check size={15} /> : <Sparkles size={15} />}{copied ? "복사됨" : "프롬프트 복사"}</button></div><textarea className="prompt-preview" readOnly value={prompt} /><div className="prompt-meta">{song.lyrics.length}개 문장 · {prompt.length.toLocaleString()}자 · 선택한 AI 서비스로 가사 원문이 전송됩니다.</div></section>
          <section className="translation-step"><div className="translation-step-head"><span>2</span><div><h3>모델의 JSON 결과 붙여넣기</h3><p>코드 블록을 제거하고, JSON 문법 오류는 DeepSeek가 자동 수정합니다.</p></div></div><textarea className="translation-json-input" value={result} onChange={(event) => { setResult(event.target.value); setError(""); }} disabled={repairing} placeholder={'{\n  "version": 1,\n  "lines": [\n    { "index": 1, "english": "...", "korean": "...", "note": null }\n  ]\n}'} />{repairing ? <div className="import-checks"><Loader2 className="spin" size={14} /> DeepSeek가 번역 내용은 유지하고 JSON 문법만 수정하고 있습니다.</div> : error ? <div className="import-error"><AlertCircle size={15} /> {error}</div> : <div className="import-checks"><Check size={14} /> 적용 전에 문장 수·순서·영어 원문·반복 문장을 자동 검증합니다.</div>}</section>
        </div>
        <div className="dialog-footer"><p>검증을 통과한 번역과 NOTE는 현재 곡에 즉시 저장됩니다.</p><div><button className="cancel-button" onClick={onClose} disabled={repairing}>취소</button><button className="primary-button" onClick={apply} disabled={!result.trim() || repairing}>{repairing ? <Loader2 className="spin" size={16} /> : <Check size={16} />} {repairing ? "JSON 자동 수정 중" : "검증 후 적용"}</button></div></div>
      </div>
    </div>
  );
}

function AddSongDialog({ onClose, onAdd, songCount, maxSongs, onManage }: {
  onClose: () => void;
  onAdd: (song: Song, translateAfter: boolean) => boolean;
  songCount: number;
  maxSongs: number;
  onManage: () => void;
}) {
  const [videoInput, setVideoInput] = useState("");
  const [videoQuery, setVideoQuery] = useState("");
  const [videoResults, setVideoResults] = useState<YouTubeResult[]>([]);
  const [video, setVideo] = useState<YouTubeResult | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [genieQuery, setGenieQuery] = useState("");
  const [genieResults, setGenieResults] = useState<GenieResult[]>([]);
  const [genieId, setGenieId] = useState("");
  const [lrc, setLrc] = useState("");
  const [mergeBeforeAdd, setMergeBeforeAdd] = useState(true);
  const [translateAfter, setTranslateAfter] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const full = songCount >= maxSongs;

  const resolveVideo = async () => {
    setBusy("video"); setError("");
    try {
      const response = await fetch("/api/youtube/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: videoInput }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      selectVideo(data);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "영상을 확인하지 못했습니다."); }
    finally { setBusy(""); }
  };

  const searchVideo = async () => {
    setBusy("youtube"); setError(""); setVideoResults([]);
    try {
      const response = await fetch("/api/youtube/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: videoQuery }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setVideoResults(data.results);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "YouTube 검색에 실패했습니다."); }
    finally { setBusy(""); }
  };

  const selectVideo = (result: YouTubeResult) => {
    setVideo(result); setTitle(result.title); setArtist(result.artist); setVideoInput(result.videoId); setVideoResults([]);
    if (!genieQuery) setGenieQuery(`${result.artist} ${result.title}`);
  };

  const searchGenie = async () => {
    setBusy("genie"); setError(""); setGenieResults([]);
    try {
      const response = await fetch("/api/genie/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: genieQuery }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setGenieResults(data.results);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Genie 검색에 실패했습니다."); }
    finally { setBusy(""); }
  };

  const fetchGenieLyrics = async (result: GenieResult) => {
    setBusy(`genie-${result.id}`); setError("");
    try {
      const response = await fetch("/api/genie/lyrics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ songId: result.id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setLrc(data.lrc); setGenieId(result.id); setTitle(result.title || title); setArtist(result.artist || artist); setGenieResults([]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "가사를 가져오지 못했습니다."); }
    finally { setBusy(""); }
  };

  const submit = async () => {
    setError("");
    if (full) { setError("보관함 한도에 도달했습니다. 기존 곡을 삭제하거나 한도를 늘려주세요."); return; }
    if (!video) { setError("먼저 YouTube URL 또는 영상 ID를 확인해주세요."); return; }
    let lyrics = parseLrc(lrc);
    if (!lyrics.length) { setError("LRC 형식 가사 또는 줄바꿈된 가사를 입력해주세요."); return; }
    const resolvedTitle = title.trim() || video.title;
    const resolvedArtist = artist.trim() || video.artist;
    setBusy("merge");
    try {
      if (mergeBeforeAdd && lyrics.length > 1) {
        const plan = await requestLyricMergeSuggestions({ title: resolvedTitle, artist: resolvedArtist, lyrics });
        lyrics = mergeLyricLines(lyrics, plan.suggestions).lyrics;
      }
      const now = Date.now();
      onAdd({
        id: crypto.randomUUID(), title: resolvedTitle, artist: resolvedArtist,
        videoId: video.videoId, thumbnail: video.thumbnail, duration: lyrics.at(-1)?.end ?? 240,
        source: genieId ? "genie" : "manual", genieId: genieId || undefined, lyrics, syncOffsetMs: 0, createdAt: now,
        progress: { position: 0, activeLine: 0, lineProgress: {}, lastStudiedAt: now },
      }, translateAfter);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "가사 구조 분석에 실패했습니다. 자동 병합을 끄고 등록할 수도 있습니다.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <div className="dialog-card add-dialog" role="dialog" aria-modal="true" aria-label="새 학습 곡 등록">
        <div className="dialog-header"><div><p className="eyebrow">ADD A SONG</p><h2>새 학습 곡 등록</h2><p>YouTube 영상과 문장별 가사를 연결합니다.</p></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div>
        {full ? <div className="capacity-alert"><AlertCircle size={18} /><div><b>보관함이 가득 찼습니다 ({songCount}/{maxSongs})</b><p>기존 곡을 삭제하거나 저장 한도를 변경한 뒤 등록할 수 있어요.</p></div><button onClick={onManage}>관리</button></div> : null}
        <div className="add-grid">
          <section className="form-section"><div className="section-number">1</div><div className="section-content"><h3>YouTube 영상 연결</h3><p>URL 또는 11자리 영상 ID는 API 키 없이 바로 사용할 수 있습니다.</p><div className="inline-form"><div className="field with-icon"><Link2 size={15} /><input value={videoInput} onChange={(event) => setVideoInput(event.target.value)} placeholder="YouTube에서 복사한 URL 또는 영상 ID" /></div><button onClick={resolveVideo} disabled={busy === "video"}>{busy === "video" ? <Loader2 className="spin" size={16} /> : "확인"}</button></div><div className="or-divider"><span>영상을 아직 찾지 않았다면</span></div><div className="inline-form youtube-search-form"><div className="field with-icon"><Search size={15} /><input value={videoQuery} onChange={(event) => setVideoQuery(event.target.value)} placeholder="아티스트와 곡명" /></div><a className="external-search" href={videoQuery.trim() ? `https://www.youtube.com/results?search_query=${encodeURIComponent(videoQuery.trim())}` : "https://www.youtube.com"} target="_blank" rel="noreferrer"><ExternalLink size={14} /> YouTube에서 검색</a><button className="secondary" onClick={searchVideo} disabled={busy === "youtube"} title="YOUTUBE_API_KEY가 있을 때만 사용 가능">{busy === "youtube" ? <Loader2 className="spin" size={16} /> : "앱 안 검색"}</button></div><p className="search-help">검색 결과에서 영상을 연 뒤 주소를 복사해 위 URL 칸에 붙여 넣으세요. 앱 안 검색만 선택적 API 키가 필요합니다.</p>{videoResults.length ? <div className="search-results">{videoResults.map((result) => <button key={result.videoId} onClick={() => selectVideo(result)}><span className="result-thumb" style={{ backgroundImage: `url(${result.thumbnail})` }} /><span><b>{result.title}</b><small>{result.artist}</small></span></button>)}</div> : null}{video ? <div className="selected-source"><span className="result-thumb" style={{ backgroundImage: `url(${video.thumbnail})` }} /><div><span>연결된 영상</span><b>{video.title}</b><small>{video.artist}</small></div><Check size={18} /></div> : null}</div></section>
          <section className="form-section"><div className="section-number">2</div><div className="section-content"><h3>동기화 가사</h3><p>Genie에서 찾거나 LRC를 직접 붙여 넣으세요.</p><div className="inline-form"><div className="field with-icon"><Search size={15} /><input value={genieQuery} onChange={(event) => setGenieQuery(event.target.value)} placeholder="Genie 곡 검색" /></div><button className="secondary" onClick={searchGenie} disabled={busy === "genie"}>{busy === "genie" ? <Loader2 className="spin" size={16} /> : "찾기"}</button></div>{genieResults.length ? <div className="search-results genie-results">{genieResults.map((result) => <button key={result.id} onClick={() => fetchGenieLyrics(result)}><span className="result-music"><Languages size={16} /></span><span><b>{result.title}</b><small>{result.artist}</small></span><em>{busy === `genie-${result.id}` ? "불러오는 중" : "가사 사용"}</em></button>)}</div> : null}<textarea className="lrc-input" value={lrc} onChange={(event) => setLrc(event.target.value)} placeholder={'[00:12.40] First line of the song\n[00:16.10] Second line of the song\n\n타임스탬프가 없으면 곡 길이에 맞춰 임시 배분됩니다.'} /><div className="line-count"><Clock3 size={14} /> {parseLrc(lrc).length}개 문장 감지 {genieId ? <span>· Genie #{genieId}</span> : null}</div></div></section>
          <section className="form-section"><div className="section-number">3</div><div className="section-content meta-fields"><h3>곡 정보 및 AI 정리</h3><div className="two-fields"><label>곡명<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Song title" /></label><label>아티스트<input value={artist} onChange={(event) => setArtist(event.target.value)} placeholder="Artist" /></label></div><label className="check-row"><input type="checkbox" checked={mergeBeforeAdd} onChange={(event) => setMergeBeforeAdd(event.target.checked)} /><span><b>등록 전에 DeepSeek로 가사를 문장 단위로 합치기</b><small>기본값은 켜짐입니다. “Today I don’t feel / like doing anything”처럼 노래방 표시용으로 잘린 여러 줄을 받아쓰기 가능한 한 문장으로 묶습니다.</small></span></label><label className="check-row"><input type="checkbox" checked={translateAfter} onChange={(event) => setTranslateAfter(event.target.checked)} /><span><b>등록 후 DeepSeek 자동 번역 초안 만들기</b><small>기본값은 꺼짐입니다. 고품질 번역은 등록 후 ‘AI 번역 가져오기’를 사용하세요.</small></span></label></div></section>
        </div>
        {error ? <div className="form-error"><AlertCircle size={16} /> {error}</div> : null}
        <div className="dialog-footer"><p>가사와 학습 기록만 Local Storage에 저장됩니다.</p><div><button className="cancel-button" onClick={onClose}>취소</button><button className="primary-button" onClick={submit} disabled={full || !video || !lrc.trim() || Boolean(busy)}>{busy === "merge" ? <Loader2 className="spin" size={16} /> : <Plus size={16} />} {busy === "merge" ? "가사 구조 분석 중" : "학습 곡 등록"}</button></div></div>
      </div>
    </div>
  );
}

function SettingsDialog({ app, onChange, onClose }: { app: PersistedState; onChange: (value: PersistedState) => void; onClose: () => void }) {
  const updateSettings = (partial: Partial<PersistedState["settings"]>) => onChange({ ...app, settings: { ...app.settings, ...partial } });
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <div className="dialog-card settings-dialog" role="dialog" aria-modal="true"><div className="dialog-header"><div><p className="eyebrow">PREFERENCES</p><h2>학습 설정</h2></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div><div className="settings-body"><label className="setting-row"><span><b>보관함 저장 한도</b><small>Local Storage를 안정적으로 쓰기 위해 3~12곡을 권장합니다.</small></span><select value={app.settings.maxSongs} onChange={(event) => updateSettings({ maxSongs: Number(event.target.value) })}>{[3, 5, 8, 10, 12].map((value) => <option key={value} value={value}>{value}곡</option>)}</select></label><label className="setting-row toggle-setting"><span><b>받아쓰기 자동 반복</b><small>기본값은 켜짐입니다. 싱크를 맞추거나 영상을 자유롭게 탐색할 때 끌 수 있습니다.</small></span><input type="checkbox" checked={app.settings.dictationAutoRepeat} onChange={(event) => updateSettings({ dictationAutoRepeat: event.target.checked })} /></label>{app.songs.length > app.settings.maxSongs ? <div className="settings-warning"><AlertCircle size={15} /> 현재 곡 수가 한도보다 많습니다. 삭제 전까지 새 곡을 추가할 수 없습니다.</div> : null}<div className="storage-note"><Library size={18} /><div><b>{app.songs.length}곡 저장 중</b><p>영상과 음원은 YouTube iframe에서 재생되며 브라우저에는 저장되지 않습니다.</p></div></div></div><div className="dialog-footer"><p>.env.local의 키 값은 브라우저로 노출되지 않습니다.</p><button className="primary-button" onClick={onClose}>완료</button></div></div>
    </div>
  );
}
