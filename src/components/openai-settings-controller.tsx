"use client";

import { Check, KeyRound, Loader2, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { OPENAI_MODEL_OPTIONS, type OpenAIModel } from "@/lib/ai-config";
import { loadOpenAIApiKey, loadOpenAIModel, saveOpenAIApiKey, saveOpenAIModel } from "@/lib/openai-key";
import type { PersistedState, Song } from "@/lib/types";

const STUDY_STORAGE_KEY = "popover.study.v1";
const AI_ENDPOINTS = new Set(["/api/translate", "/api/lyrics/merge", "/api/translate/repair"]);

type AISettings = {
  apiKey: string;
  model: OpenAIModel;
};

type TranslateResponse = {
  translations?: string[];
  studyNotes?: Array<string | null>;
  error?: string;
};

function requestPath(input: RequestInfo | URL) {
  try {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    return new URL(url, window.location.origin).pathname;
  } catch {
    return "";
  }
}

function injectAISettings(input: RequestInfo | URL, init: RequestInit | undefined, settings: AISettings) {
  if (!AI_ENDPOINTS.has(requestPath(input)) || !init?.body || typeof init.body !== "string") return init;
  try {
    const parsed = JSON.parse(init.body) as Record<string, unknown>;
    return {
      ...init,
      body: JSON.stringify({
        ...parsed,
        apiKey: typeof parsed.apiKey === "string" && parsed.apiKey ? parsed.apiKey : settings.apiKey,
        model: typeof parsed.model === "string" && parsed.model ? parsed.model : settings.model,
      }),
    };
  } catch {
    return init;
  }
}

function readStudyState() {
  try {
    const raw = window.localStorage.getItem(STUDY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (parsed.version !== 1 || !Array.isArray(parsed.songs)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function currentSong(state: PersistedState | null) {
  if (!state) return null;
  return state.songs.find((song) => song.id === state.selectedSongId) ?? state.songs[0] ?? null;
}

export function OpenAISettingsController() {
  const [settingsTarget, setSettingsTarget] = useState<HTMLElement | null>(null);
  const [songMenuTarget, setSongMenuTarget] = useState<HTMLElement | null>(null);
  const [draftKey, setDraftKey] = useState("");
  const [model, setModel] = useState<OpenAIModel>(OPENAI_MODEL_OPTIONS[0].value);
  const [keySaved, setKeySaved] = useState(false);
  const [translating, setTranslating] = useState(false);
  const settingsRef = useRef<AISettings>({ apiKey: "", model: OPENAI_MODEL_OPTIONS[0].value });

  useEffect(() => {
    const apiKey = loadOpenAIApiKey();
    const savedModel = loadOpenAIModel();
    settingsRef.current = { apiKey, model: savedModel };
    setDraftKey(apiKey);
    setModel(savedModel);
    setKeySaved(Boolean(apiKey));
  }, []);

  useEffect(() => {
    const syncTargets = () => {
      setSettingsTarget(document.querySelector<HTMLElement>(".simple-settings-body"));
      setSongMenuTarget(document.querySelector<HTMLElement>(".simple-song-menu > div"));
    };
    syncTargets();
    const observer = new MutationObserver(syncTargets);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const originalFetch = window.fetch;
    const patchedFetch: typeof window.fetch = (input, init) => {
      const nextInit = injectAISettings(input, init, settingsRef.current);
      return originalFetch.call(window, input, nextInit);
    };
    window.fetch = patchedFetch;
    return () => {
      if (window.fetch === patchedFetch) window.fetch = originalFetch;
    };
  }, []);

  const saveKey = () => {
    const value = draftKey.trim();
    saveOpenAIApiKey(value);
    settingsRef.current = { ...settingsRef.current, apiKey: value };
    setKeySaved(Boolean(value));
  };

  const clearKey = () => {
    saveOpenAIApiKey("");
    settingsRef.current = { ...settingsRef.current, apiKey: "" };
    setDraftKey("");
    setKeySaved(false);
  };

  const changeModel = (value: OpenAIModel) => {
    saveOpenAIModel(value);
    settingsRef.current = { ...settingsRef.current, model: value };
    setModel(value);
  };

  const translateCurrentSong = async () => {
    const { apiKey, model: currentModel } = settingsRef.current;
    if (!apiKey) {
      window.alert("설정에서 OpenAI API 키를 먼저 저장해주세요.");
      document.querySelector<HTMLButtonElement>(".simple-top-actions .simple-icon-text")?.click();
      return;
    }

    const snapshot = readStudyState();
    const song = currentSong(snapshot);
    if (!song?.lyrics.length) {
      window.alert("번역할 곡을 찾지 못했습니다.");
      return;
    }

    setTranslating(true);
    const translations: Array<string | null> = song.lyrics.map((line) => line.korean ?? null);
    const notes: Array<string | null> = song.lyrics.map((line) => line.note ?? null);
    const batchSize = 12;

    try {
      for (let startIndex = 0; startIndex < song.lyrics.length; startIndex += batchSize) {
        const endIndex = Math.min(startIndex + batchSize, song.lyrics.length);
        const response = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey,
            model: currentModel,
            title: song.title,
            artist: song.artist,
            lyrics: song.lyrics.map((line) => line.english),
            startIndex,
            endIndex,
            existingTranslations: translations,
            existingNotes: notes,
          }),
        });
        const data = await response.json() as TranslateResponse;
        if (!response.ok || !data.translations) throw new Error(data.error ?? "GPT 번역에 실패했습니다.");
        data.translations.forEach((translation, offset) => {
          translations[startIndex + offset] = translation;
          notes[startIndex + offset] = data.studyNotes?.[offset] ?? null;
        });
      }

      const latest = readStudyState();
      if (!latest) throw new Error("학습 데이터를 다시 불러오지 못했습니다.");
      const updated: PersistedState = {
        ...latest,
        songs: latest.songs.map((item) => item.id === song.id ? {
          ...item,
          lyrics: item.lyrics.map((line, index) => ({
            ...line,
            korean: translations[index] ?? line.korean,
            note: notes[index] ?? undefined,
          })),
        } satisfies Song : item),
      };
      window.localStorage.setItem(STUDY_STORAGE_KEY, JSON.stringify(updated));
      window.location.reload();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "GPT 번역에 실패했습니다.");
      setTranslating(false);
    }
  };

  return <>
    {settingsTarget ? createPortal(
      <section className="openai-settings-card">
        <div className="openai-settings-heading">
          <Sparkles size={18} />
          <span><b>OpenAI 자동화</b><small>가사 문장 정리 · 문맥 번역 · 영어 학습 노트를 GPT가 처리합니다.</small></span>
        </div>
        <label className="openai-settings-row">
          <span><b>모델</b><small>기본은 품질 우선 GPT-6 Astra</small></span>
          <select value={model} onChange={(event) => changeModel(event.target.value as OpenAIModel)}>
            {OPENAI_MODEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label} · {option.description}</option>)}
          </select>
        </label>
        <div className="openai-key-row">
          <span><b>OpenAI API 키</b><small>이 브라우저에만 별도로 저장되며 학습 데이터 백업 JSON에는 들어가지 않습니다.</small></span>
          <div className="openai-key-control">
            <KeyRound size={15} />
            <input
              type="password"
              autoComplete="off"
              value={draftKey}
              onChange={(event) => { setDraftKey(event.target.value); setKeySaved(event.target.value.trim() === settingsRef.current.apiKey && Boolean(settingsRef.current.apiKey)); }}
              placeholder="sk-…"
              aria-label="OpenAI API 키"
            />
            <button type="button" onClick={saveKey} disabled={!draftKey.trim()}>{keySaved ? <Check size={14} /> : null}{keySaved ? "저장됨" : "저장"}</button>
            {settingsRef.current.apiKey ? <button type="button" className="openai-key-delete" onClick={clearKey} aria-label="OpenAI API 키 삭제"><Trash2 size={14} /></button> : null}
          </div>
        </div>
        <p className="openai-settings-note">새 곡의 “문장 단위 자동 정리”와 “추가 후 번역 자동 준비”도 이 설정을 사용합니다.</p>
      </section>,
      settingsTarget,
    ) : null}

    {songMenuTarget ? createPortal(
      <button type="button" className="openai-song-translate" onClick={() => void translateCurrentSong()} disabled={translating}>
        {translating ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
        {translating ? "GPT 번역 중…" : "GPT 번역 · 노트"}
      </button>,
      songMenuTarget,
    ) : null}
  </>;
}
