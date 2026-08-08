"use client";

/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock3,
  ExternalLink,
  Eye,
  EyeOff,
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
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { answerScore, formatTime, parseLrc } from "@/lib/lrc";
import { defaultState, loadState, saveState } from "@/lib/storage";
import type { PersistedState, Song, StudyMode } from "@/lib/types";
import { YouTubePlayer, type YouTubePlayerHandle } from "./youtube-player";

type Toast = { message: string; tone?: "normal" | "error" | "success" };
type GenieResult = { id: string; title: string; artist: string };
type YouTubeResult = { videoId: string; title: string; artist: string; thumbnail: string };

const EMPTY_PROGRESS = { draft: "", attempts: 0, bestScore: 0, completed: false };

export function PopoverApp() {
  const [app, setApp] = useState<PersistedState>(defaultState);
  const [hydrated, setHydrated] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [mode, setMode] = useState<StudyMode>("listen");
  const [loopLine, setLoopLine] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [revealed, setRevealed] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [translating, setTranslating] = useState(false);
  const playerRef = useRef<YouTubePlayerHandle>(null);
  const activeRowRef = useRef<HTMLButtonElement>(null);
  const dictationRef = useRef<HTMLInputElement>(null);
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
  const activeIndex = useMemo(() => {
    if (!song?.lyrics.length) return 0;
    let result = 0;
    for (let index = 0; index < song.lyrics.length; index += 1) {
      if (song.lyrics[index].start <= effectiveTime + 0.02) result = index;
      else break;
    }
    return result;
  }, [effectiveTime, song]);
  const activeLine = song?.lyrics[activeIndex];
  const duration = playerDuration || song?.duration || song?.lyrics.at(-1)?.end || 0;

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
    setRevealed(false);
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
    setRevealed(false);
    window.requestAnimationFrame(() => {
      activeRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (mode === "dictation") dictationRef.current?.focus();
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

  const togglePlayback = useCallback(() => {
    if (!song) return;
    if (song.videoId) playerRef.current?.toggle();
    else setPlaying((value) => !value);
  }, [song]);

  useEffect(() => {
    if (!loopLine || !playing || !activeLine || !song) return;
    if (effectiveTime >= activeLine.end - 0.08) seekLine(activeIndex);
  }, [activeIndex, activeLine, effectiveTime, loopLine, playing, seekLine, song]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
      } else if (event.key.toLowerCase() === "j") seekLine(activeIndex - 1);
      else if (event.key.toLowerCase() === "k") seekLine(activeIndex + 1);
      else if (event.key.toLowerCase() === "r") setLoopLine((value) => !value);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, seekLine, togglePlayback]);

  const setRate = (rate: number) => {
    setPlaybackRate(rate);
    playerRef.current?.setRate(rate);
  };

  useEffect(() => {
    if (playerReady) playerRef.current?.setRate(playbackRate);
  }, [playbackRate, playerReady, song?.id]);

  const setOffset = (offset: number) => {
    if (!song) return;
    updateSong(song.id, (value) => ({ ...value, syncOffsetMs: Math.max(-10000, Math.min(10000, offset)) }));
  };

  const stampActiveLine = () => {
    if (!song || !activeLine) return;
    updateSong(song.id, (value) => ({
      ...value,
      lyrics: value.lyrics.map((line, index) =>
        index === activeIndex
          ? {
              ...line,
              start: Math.max(value.lyrics[index - 1]?.start ?? 0, currentTime + value.syncOffsetMs / 1000),
            }
          : line,
      ),
    }));
    showToast("현재 재생 위치를 문장 시작점으로 저장했습니다.", "success");
  };

  const activeProgress = activeLine
    ? song?.progress.lineProgress[activeLine.id] ?? EMPTY_PROGRESS
    : EMPTY_PROGRESS;

  const setDraft = (draft: string) => {
    if (!song || !activeLine) return;
    updateSong(song.id, (value) => ({
      ...value,
      progress: {
        ...value.progress,
        lineProgress: {
          ...value.progress.lineProgress,
          [activeLine.id]: { ...(value.progress.lineProgress[activeLine.id] ?? EMPTY_PROGRESS), draft },
        },
      },
    }));
  };

  const checkAnswer = () => {
    if (!song || !activeLine || !activeProgress.draft.trim()) return;
    const score = answerScore(activeProgress.draft, activeLine.english);
    const completed = score >= 85;
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
              attempts: before.attempts + 1,
              bestScore: Math.max(before.bestScore, score),
              completed: before.completed || completed,
            },
          },
        },
      };
    });
    setRevealed(true);
    showToast(completed ? `${score}점 · 문장을 익혔어요.` : `${score}점 · 다시 듣고 빈 부분을 확인해보세요.`, completed ? "success" : "normal");
    if (completed && app.settings.autoAdvance && activeIndex < song.lyrics.length - 1) {
      window.setTimeout(() => seekLine(activeIndex + 1), 700);
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
    setTranslating(true);
    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: target.title, artist: target.artist, lyrics: target.lyrics.map((line) => line.english) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      updateSong(target.id, (value) => ({
        ...value,
        lyrics: value.lyrics.map((line, index) => ({
          ...line,
          korean: data.translations[index],
          note: data.studyNotes?.[index] || undefined,
        })),
      }));
      showToast(data.mood ? `번역 완료 · ${data.mood}` : "곡 전체 맥락 번역을 완료했습니다.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "번역에 실패했습니다.", "error");
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

  const completedCount = song
    ? Object.values(song.progress.lineProgress).filter((progress) => progress.completed).length
    : 0;

  if (!hydrated) return <div className="app-loading">Popover를 준비하고 있습니다…</div>;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><span /></div>
          <div><strong>popover</strong><small>POP SONG STUDY DESK</small></div>
        </div>
        <div className="now-playing-mini">
          {song ? <><span className={playing ? "status-pulse active" : "status-pulse"} /> <b>{song.title}</b><span>·</span><span>{song.artist}</span></> : "곡을 추가해 시작하세요"}
        </div>
        <div className="top-actions">
          <button className="ghost-button" onClick={() => setSettingsOpen(true)}><Settings2 size={16} /> 설정</button>
          <button className="primary-button" onClick={() => setAddOpen(true)}><Plus size={17} /> 곡 추가</button>
        </div>
      </header>

      <div className="workspace">
        <aside className="library-panel">
          <div className="panel-title-row">
            <div><p className="eyebrow">MY LIBRARY</p><h2>학습 곡</h2></div>
            <span className="capacity-badge">{app.songs.length} / {app.settings.maxSongs}</span>
          </div>
          <button className="add-song-rail" onClick={() => setAddOpen(true)}><Plus size={16} /> 새 곡 등록</button>
          <div className="song-list">
            {app.songs.map((item) => {
              const mastered = Object.values(item.progress.lineProgress).filter((value) => value.completed).length;
              const percentage = item.lyrics.length ? Math.round((mastered / item.lyrics.length) * 100) : 0;
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

        <section className="player-column">
          {song ? (
            <>
              <div className="player-heading">
                <div><p className="eyebrow">NOW STUDYING</p><h1>{song.title}</h1><p>{song.artist}</p></div>
                {song.videoId ? <a className="youtube-link" href={`https://youtu.be/${song.videoId}`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> YouTube</a> : <span className="demo-chip">DEMO</span>}
              </div>

              <div className="video-stage">
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

              <div className="focus-line-card">
                <div className="focus-line-meta"><span>LINE {String(activeIndex + 1).padStart(2, "0")}</span><span>{formatTime(activeLine?.start ?? 0)}</span></div>
                <p className="focus-english">{activeLine?.english ?? "가사를 등록해주세요."}</p>
                <p className="focus-korean">{activeLine?.korean ?? "번역 버튼으로 곡 전체 맥락 번역을 만들 수 있어요."}</p>
              </div>

              <div className="transport-card">
                <div className="timeline-row">
                  <span>{formatTime(currentTime)}</span>
                  <input aria-label="재생 위치" type="range" min={0} max={Math.max(duration, 1)} step={0.1} value={Math.min(currentTime, duration || 0)} onChange={(event) => seekTo(Number(event.target.value))} />
                  <span>{formatTime(duration)}</span>
                </div>
                <div className="primary-controls">
                  <button className="round-control" aria-label="이전 문장" onClick={() => seekLine(activeIndex - 1)}><ChevronLeft size={23} /></button>
                  <button className="play-control" aria-label={playing ? "일시정지" : "재생"} onClick={togglePlayback}>{playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}</button>
                  <button className="round-control" aria-label="다음 문장" onClick={() => seekLine(activeIndex + 1)}><ChevronRight size={23} /></button>
                </div>
                <div className="utility-controls">
                  <button className={loopLine ? "utility-button active" : "utility-button"} onClick={() => setLoopLine((value) => !value)}><RotateCcw size={15} /> 문장 반복</button>
                  <label className="rate-control"><span>속도</span><select value={playbackRate} onChange={(event) => setRate(Number(event.target.value))}><option value={0.75}>0.75×</option><option value={1}>1.0×</option><option value={1.25}>1.25×</option><option value={1.5}>1.5×</option></select></label>
                  <span className={song.videoId && !playerReady ? "ready-state pending" : "ready-state"}>{song.videoId && !playerReady ? "플레이어 연결 중" : "준비됨"}</span>
                </div>
              </div>

              <div className="sync-card">
                <div className="sync-title"><SlidersHorizontal size={16} /><div><b>싱크 미세 조정</b><small>가사가 늦으면 +, 빠르면 −</small></div></div>
                <div className="offset-stepper"><button onClick={() => setOffset(song.syncOffsetMs - 100)}>−100</button><label><input type="number" value={song.syncOffsetMs} onChange={(event) => setOffset(Number(event.target.value))} /><span>ms</span></label><button onClick={() => setOffset(song.syncOffsetMs + 100)}>+100</button></div>
                <button className="stamp-button" onClick={stampActiveLine}><Clock3 size={15} /> 현재 위치로 시작점 찍기</button>
              </div>
            </>
          ) : (
            <div className="no-song"><Library size={36} /><h2>학습할 곡을 등록해주세요</h2><button className="primary-button" onClick={() => setAddOpen(true)}><Plus size={16} /> 곡 추가</button></div>
          )}
        </section>

        <section className="lyrics-panel">
          <div className="lyrics-toolbar">
            <div><p className="eyebrow">LYRIC TRACKER</p><h2>문장 트래킹</h2></div>
            <div className="toolbar-actions">
              <button className="translate-button" disabled={!song || translating} onClick={() => song && void translateSong(song)}>{translating ? <Loader2 className="spin" size={15} /> : <Languages size={15} />} 전체 번역</button>
              <div className="mode-switch"><button className={mode === "listen" ? "active" : ""} onClick={() => setMode("listen")}>듣기</button><button className={mode === "dictation" ? "active" : ""} onClick={() => setMode("dictation")}>받아쓰기</button></div>
            </div>
          </div>
          <div className="progress-strip"><span><b>{completedCount}</b> / {song?.lyrics.length ?? 0} 문장 완료</span><div><i style={{ width: `${song?.lyrics.length ? (completedCount / song.lyrics.length) * 100 : 0}%` }} /></div></div>

          <div className="lyrics-scroll">
            {song?.lyrics.map((line, index) => {
              const progress = song.progress.lineProgress[line.id];
              const isActive = index === activeIndex;
              return (
                <button ref={isActive ? activeRowRef : undefined} className={isActive ? "lyric-row active" : "lyric-row"} key={line.id} onClick={() => seekLine(index)}>
                  <span className="line-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="line-body">
                    <span className={mode === "dictation" && isActive && !revealed ? "line-english concealed" : "line-english"}>{line.english}</span>
                    <span className="line-korean">{line.korean || "번역 대기 중"}</span>
                    {line.note ? <span className="study-note">NOTE · {line.note}</span> : null}
                  </span>
                  <span className="line-status">{progress?.completed ? <Check size={15} /> : formatTime(line.start)}</span>
                </button>
              );
            })}
          </div>

          {mode === "dictation" && song && activeLine ? (
            <div className="dictation-dock">
              <div className="dictation-head"><span>LINE {activeIndex + 1} 받아쓰기</span><button onClick={() => setRevealed((value) => !value)}>{revealed ? <EyeOff size={15} /> : <Eye size={15} />}{revealed ? "정답 숨기기" : "정답 보기"}</button></div>
              {app.settings.showKoreanInDictation ? <p className="dictation-hint">{activeLine.korean || "먼저 전체 번역을 실행하면 한국어 힌트가 표시됩니다."}</p> : null}
              <div className="dictation-input-row"><input ref={dictationRef} value={activeProgress.draft} placeholder="들은 문장을 영어로 입력하세요" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") checkAnswer(); }} /><button onClick={checkAnswer}><Check size={17} /> 확인</button></div>
              <div className="dictation-foot"><span>최고 {activeProgress.bestScore}점</span><span>{activeProgress.attempts}회 시도</span><span>Enter로 채점</span></div>
            </div>
          ) : (
            <div className="shortcut-bar"><Keyboard size={15} /><span><kbd>Space</kbd> 재생</span><span><kbd>J</kbd>/<kbd>K</kbd> 문장 이동</span><span><kbd>R</kbd> 반복</span></div>
          )}
        </section>
      </div>

      {addOpen ? <AddSongDialog onClose={() => setAddOpen(false)} onAdd={addSong} songCount={app.songs.length} maxSongs={app.settings.maxSongs} onManage={() => { setAddOpen(false); setSettingsOpen(true); }} /> : null}
      {settingsOpen ? <SettingsDialog app={app} onChange={setApp} onClose={() => setSettingsOpen(false)} /> : null}
      {toast ? <div className={`toast ${toast.tone ?? "normal"}`}>{toast.tone === "error" ? <AlertCircle size={17} /> : toast.tone === "success" ? <CircleCheck size={17} /> : null}{toast.message}</div> : null}
    </main>
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
  const [translateAfter, setTranslateAfter] = useState(true);
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

  const submit = () => {
    setError("");
    if (full) { setError("보관함 한도에 도달했습니다. 기존 곡을 삭제하거나 한도를 늘려주세요."); return; }
    if (!video) { setError("먼저 YouTube URL 또는 영상 ID를 확인해주세요."); return; }
    const lyrics = parseLrc(lrc);
    if (!lyrics.length) { setError("LRC 형식 가사 또는 줄바꿈된 가사를 입력해주세요."); return; }
    const now = Date.now();
    onAdd({
      id: crypto.randomUUID(), title: title.trim() || video.title, artist: artist.trim() || video.artist,
      videoId: video.videoId, thumbnail: video.thumbnail, duration: lyrics.at(-1)?.end ?? 240,
      source: genieId ? "genie" : "manual", genieId: genieId || undefined, lyrics, syncOffsetMs: 0, createdAt: now,
      progress: { position: 0, activeLine: 0, lineProgress: {}, lastStudiedAt: now },
    }, translateAfter);
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <div className="dialog-card add-dialog" role="dialog" aria-modal="true" aria-label="새 학습 곡 등록">
        <div className="dialog-header"><div><p className="eyebrow">ADD A SONG</p><h2>새 학습 곡 등록</h2><p>YouTube 영상과 문장별 가사를 연결합니다.</p></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div>
        {full ? <div className="capacity-alert"><AlertCircle size={18} /><div><b>보관함이 가득 찼습니다 ({songCount}/{maxSongs})</b><p>기존 곡을 삭제하거나 저장 한도를 변경한 뒤 등록할 수 있어요.</p></div><button onClick={onManage}>관리</button></div> : null}
        <div className="add-grid">
          <section className="form-section"><div className="section-number">1</div><div className="section-content"><h3>YouTube 영상 연결</h3><p>URL 또는 11자리 영상 ID는 API 키 없이 바로 사용할 수 있습니다.</p><div className="inline-form"><div className="field with-icon"><Link2 size={15} /><input value={videoInput} onChange={(event) => setVideoInput(event.target.value)} placeholder="https://youtu.be/... 또는 영상 ID" /></div><button onClick={resolveVideo} disabled={busy === "video"}>{busy === "video" ? <Loader2 className="spin" size={16} /> : "확인"}</button></div><div className="or-divider"><span>또는 앱에서 검색</span></div><div className="inline-form"><div className="field with-icon"><Search size={15} /><input value={videoQuery} onChange={(event) => setVideoQuery(event.target.value)} placeholder="아티스트와 곡명" /></div><button className="secondary" onClick={searchVideo} disabled={busy === "youtube"}>{busy === "youtube" ? <Loader2 className="spin" size={16} /> : "검색"}</button></div>{videoResults.length ? <div className="search-results">{videoResults.map((result) => <button key={result.videoId} onClick={() => selectVideo(result)}><span className="result-thumb" style={{ backgroundImage: `url(${result.thumbnail})` }} /><span><b>{result.title}</b><small>{result.artist}</small></span></button>)}</div> : null}{video ? <div className="selected-source"><span className="result-thumb" style={{ backgroundImage: `url(${video.thumbnail})` }} /><div><span>연결된 영상</span><b>{video.title}</b><small>{video.artist}</small></div><Check size={18} /></div> : null}</div></section>
          <section className="form-section"><div className="section-number">2</div><div className="section-content"><h3>동기화 가사</h3><p>Genie에서 찾거나 LRC를 직접 붙여 넣으세요.</p><div className="inline-form"><div className="field with-icon"><Search size={15} /><input value={genieQuery} onChange={(event) => setGenieQuery(event.target.value)} placeholder="Genie 곡 검색" /></div><button className="secondary" onClick={searchGenie} disabled={busy === "genie"}>{busy === "genie" ? <Loader2 className="spin" size={16} /> : "찾기"}</button></div>{genieResults.length ? <div className="search-results genie-results">{genieResults.map((result) => <button key={result.id} onClick={() => fetchGenieLyrics(result)}><span className="result-music"><Languages size={16} /></span><span><b>{result.title}</b><small>{result.artist}</small></span><em>{busy === `genie-${result.id}` ? "불러오는 중" : "가사 사용"}</em></button>)}</div> : null}<textarea className="lrc-input" value={lrc} onChange={(event) => setLrc(event.target.value)} placeholder={'[00:12.40] First line of the song\n[00:16.10] Second line of the song\n\n타임스탬프가 없으면 곡 길이에 맞춰 임시 배분됩니다.'} /><div className="line-count"><Clock3 size={14} /> {parseLrc(lrc).length}개 문장 감지 {genieId ? <span>· Genie #{genieId}</span> : null}</div></div></section>
          <section className="form-section"><div className="section-number">3</div><div className="section-content meta-fields"><h3>곡 정보 및 번역</h3><div className="two-fields"><label>곡명<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Song title" /></label><label>아티스트<input value={artist} onChange={(event) => setArtist(event.target.value)} placeholder="Artist" /></label></div><label className="check-row"><input type="checkbox" checked={translateAfter} onChange={(event) => setTranslateAfter(event.target.checked)} /><span><b>등록 후 DeepSeek로 전체 맥락 번역</b><small>영어 원문 아래에 자연스러운 한국어 번역을 붙입니다.</small></span></label></div></section>
        </div>
        {error ? <div className="form-error"><AlertCircle size={16} /> {error}</div> : null}
        <div className="dialog-footer"><p>가사와 학습 기록만 Local Storage에 저장됩니다.</p><div><button className="cancel-button" onClick={onClose}>취소</button><button className="primary-button" onClick={submit} disabled={full || !video || !lrc.trim()}><Plus size={16} /> 학습 곡 등록</button></div></div>
      </div>
    </div>
  );
}

function SettingsDialog({ app, onChange, onClose }: { app: PersistedState; onChange: (value: PersistedState) => void; onClose: () => void }) {
  const updateSettings = (partial: Partial<PersistedState["settings"]>) => onChange({ ...app, settings: { ...app.settings, ...partial } });
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <div className="dialog-card settings-dialog" role="dialog" aria-modal="true"><div className="dialog-header"><div><p className="eyebrow">PREFERENCES</p><h2>학습 설정</h2></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div><div className="settings-body"><label className="setting-row"><span><b>보관함 저장 한도</b><small>Local Storage를 안정적으로 쓰기 위해 3~12곡을 권장합니다.</small></span><select value={app.settings.maxSongs} onChange={(event) => updateSettings({ maxSongs: Number(event.target.value) })}>{[3, 5, 8, 10, 12].map((value) => <option key={value} value={value}>{value}곡</option>)}</select></label>{app.songs.length > app.settings.maxSongs ? <div className="settings-warning"><AlertCircle size={15} /> 현재 곡 수가 한도보다 많습니다. 삭제 전까지 새 곡을 추가할 수 없습니다.</div> : null}<label className="setting-row toggle-setting"><span><b>정답 후 자동으로 다음 문장 이동</b><small>받아쓰기 85점 이상이면 다음 문장으로 넘어갑니다.</small></span><input type="checkbox" checked={app.settings.autoAdvance} onChange={(event) => updateSettings({ autoAdvance: event.target.checked })} /></label><label className="setting-row toggle-setting"><span><b>받아쓰기에서 한국어 힌트 표시</b><small>영어 원문은 채점 전까지 숨겨집니다.</small></span><input type="checkbox" checked={app.settings.showKoreanInDictation} onChange={(event) => updateSettings({ showKoreanInDictation: event.target.checked })} /></label><div className="storage-note"><Library size={18} /><div><b>{app.songs.length}곡 저장 중</b><p>영상과 음원은 YouTube iframe에서 재생되며 브라우저에는 저장되지 않습니다.</p></div></div></div><div className="dialog-footer"><p>.env.local의 키 값은 브라우저로 노출되지 않습니다.</p><button className="primary-button" onClick={onClose}>완료</button></div></div>
    </div>
  );
}
