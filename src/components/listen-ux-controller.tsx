"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)
    || element.isContentEditable
    || Boolean(element.closest(".dialog-backdrop"));
}

function isListenMode() {
  return Boolean(document.querySelector(".simple-workspace.listen"));
}

function dispatchExistingShortcut(key: "j" | "k") {
  window.dispatchEvent(new KeyboardEvent("keydown", {
    key,
    code: key === "j" ? "KeyJ" : "KeyK",
    bubbles: true,
  }));
}

export function ListenUXController() {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const syncTarget = () => setTarget(document.querySelector<HTMLElement>(".simple-workspace.listen .simple-focus-card"));
    syncTarget();
    const observer = new MutationObserver(syncTarget);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isListenMode() || isTypingTarget(event.target)) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      event.preventDefault();
      event.stopImmediatePropagation();
      dispatchExistingShortcut(event.key === "ArrowLeft" ? "j" : "k");
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  if (!target) return null;

  return createPortal(
    <div className="listen-nav-strip" aria-label="가사 구절 이동">
      <button type="button" onClick={() => dispatchExistingShortcut("j")} title="이전 구절 (← 또는 J)">
        <ChevronLeft size={15} />
        <span>이전 구절</span>
        <kbd>←</kbd>
      </button>
      <div className="listen-shortcut-hint">
        <span><kbd>Space</kbd> 재생</span>
        <span><kbd>R</kbd> 반복</span>
        <span><kbd>T</kbd> 뜻</span>
        <span><kbd>J/K</kbd> 구절 이동</span>
      </div>
      <button type="button" onClick={() => dispatchExistingShortcut("k")} title="다음 구절 (→ 또는 K)">
        <span>다음 구절</span>
        <kbd>→</kbd>
        <ChevronRight size={15} />
      </button>
    </div>,
    target,
  );
}
