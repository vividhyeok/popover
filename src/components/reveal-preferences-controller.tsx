"use client";

import { Check, Eye, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const STORAGE_KEY = "popover.reveal.preferences.v1";

type RevealPreferences = {
  autoMeaning: boolean;
  autoNote: boolean;
};

const DEFAULTS: RevealPreferences = {
  autoMeaning: false,
  autoNote: false,
};

function currentLineKey() {
  const position = document.querySelector<HTMLElement>(".simple-focus-meta > span")?.textContent?.trim() ?? "";
  const english = document.querySelector<HTMLElement>(".simple-focus-english")?.textContent?.trim() ?? "";
  return `${position}::${english}`;
}

function revealButton(kind: "meaning" | "note") {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".simple-reveal-row button"));
  return buttons.find((button) => {
    const text = button.textContent ?? "";
    return kind === "meaning" ? text.includes("뜻") : text.includes("표현");
  });
}

function revealVisible(kind: "meaning" | "note") {
  return Boolean(document.querySelector(kind === "meaning" ? ".simple-focus-korean" : ".simple-focus-note"));
}

function setCurrentReveal(kind: "meaning" | "note", visible: boolean) {
  const button = revealButton(kind);
  if (!button || revealVisible(kind) === visible) return;
  button.click();
}

function toggleCurrentReveal(kind: "meaning" | "note") {
  const button = revealButton(kind);
  if (button) button.click();
}

export function RevealPreferencesController() {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [preferences, setPreferences] = useState<RevealPreferences>(DEFAULTS);
  const preferencesRef = useRef(preferences);
  const lastLineRef = useRef("");
  const meaningOverrideRef = useRef<string | null>(null);
  const noteOverrideRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<RevealPreferences> | null;
      if (saved) {
        setPreferences({
          autoMeaning: Boolean(saved.autoMeaning),
          autoNote: Boolean(saved.autoNote),
        });
      }
    } catch {
      // Ignore malformed preference data and keep safe defaults.
    }
  }, []);

  useEffect(() => {
    preferencesRef.current = preferences;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    const syncPortalTarget = () => setPortalTarget(document.querySelector<HTMLElement>(".simple-top-actions"));
    syncPortalTarget();
    const observer = new MutationObserver(syncPortalTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let frame = 0;
    const applyAutomaticReveal = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const lineKey = currentLineKey();
        if (!lineKey) return;
        if (lineKey !== lastLineRef.current) {
          lastLineRef.current = lineKey;
          meaningOverrideRef.current = null;
          noteOverrideRef.current = null;
        }

        if (preferencesRef.current.autoMeaning && meaningOverrideRef.current !== lineKey) {
          setCurrentReveal("meaning", true);
        }
        if (preferencesRef.current.autoNote && noteOverrideRef.current !== lineKey) {
          setCurrentReveal("note", true);
        }
      });
    };

    applyAutomaticReveal();
    const observer = new MutationObserver(applyAutomaticReveal);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable || target.closest(".dialog-backdrop")) return;
      if (!document.querySelector(".simple-app")) return;

      const key = event.key.toLowerCase();
      if (key !== "t" && key !== "n") return;

      // V2 already has a T listener. Handle reveal shortcuts in capture phase and
      // stop the event so each shortcut runs exactly once.
      event.preventDefault();
      event.stopImmediatePropagation();

      const kind = key === "t" ? "meaning" : "note";
      const lineKey = currentLineKey();

      if (event.shiftKey) {
        const setting = kind === "meaning" ? "autoMeaning" : "autoNote";
        const next = !preferencesRef.current[setting];
        const nextPreferences = { ...preferencesRef.current, [setting]: next };
        preferencesRef.current = nextPreferences;
        setPreferences(nextPreferences);

        if (kind === "meaning") meaningOverrideRef.current = null;
        else noteOverrideRef.current = null;
        setCurrentReveal(kind, next);
        return;
      }

      if (kind === "meaning") meaningOverrideRef.current = lineKey;
      else noteOverrideRef.current = lineKey;
      toggleCurrentReveal(kind);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  const setAuto = (kind: "meaning" | "note", enabled: boolean) => {
    const setting = kind === "meaning" ? "autoMeaning" : "autoNote";
    const nextPreferences = { ...preferencesRef.current, [setting]: enabled };
    preferencesRef.current = nextPreferences;
    setPreferences(nextPreferences);

    if (kind === "meaning") meaningOverrideRef.current = null;
    else noteOverrideRef.current = null;
    setCurrentReveal(kind, enabled);
  };

  if (!portalTarget) return null;

  return createPortal(
    <div className="reveal-pref-root">
      <button
        type="button"
        className={`reveal-pref-trigger ${preferences.autoMeaning || preferences.autoNote ? "active" : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title="뜻·표현 표시 방식"
      >
        <Eye size={16} />
        <span>표시</span>
      </button>
      {open ? (
        <div className="reveal-pref-menu">
          <div className="reveal-pref-heading">
            <strong>자동 표시</strong>
            <span>문장이 바뀌어도 유지</span>
          </div>
          <button type="button" onClick={() => setAuto("meaning", !preferences.autoMeaning)}>
            <Eye size={15} />
            <span><b>뜻 항상 보기</b><small>Shift+T · 현재 문장만 T</small></span>
            {preferences.autoMeaning ? <Check size={15} /> : <i />}
          </button>
          <button type="button" onClick={() => setAuto("note", !preferences.autoNote)}>
            <Sparkles size={15} />
            <span><b>표현 항상 보기</b><small>Shift+N · 현재 문장만 N</small></span>
            {preferences.autoNote ? <Check size={15} /> : <i />}
          </button>
          <p>T/N은 현재 문장만 바꾸고, 다음 문장부터는 자동 표시 설정을 다시 따릅니다.</p>
        </div>
      ) : null}
    </div>,
    portalTarget,
  );
}
