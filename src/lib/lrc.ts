import type { LyricLine } from "./types";

const TIMESTAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

export function parseLrc(input: string, fallbackDuration = 240): LyricLine[] {
  const timed: Array<Omit<LyricLine, "id" | "end">> = [];
  const plain: string[] = [];

  for (const rawLine of input.replace(/\r/g, "").split("\n")) {
    const line = rawLine.trim();
    if (!line || /^\[(ar|ti|al|by|offset):/i.test(line)) continue;

    const timestamps = [...line.matchAll(TIMESTAMP)];
    const text = line.replace(TIMESTAMP, "").trim();
    if (!text) continue;

    if (timestamps.length === 0) {
      plain.push(text);
      continue;
    }

    for (const match of timestamps) {
      const fraction = (match[3] ?? "0").padEnd(3, "0").slice(0, 3);
      timed.push({
        start: Number(match[1]) * 60 + Number(match[2]) + Number(fraction) / 1000,
        english: text,
      });
    }
  }

  if (timed.length === 0 && plain.length > 0) {
    const startPad = 2;
    const available = Math.max(fallbackDuration - startPad - 3, plain.length * 2);
    const step = available / plain.length;
    return plain.map((english, index) => ({
      id: crypto.randomUUID(),
      start: startPad + index * step,
      end: startPad + (index + 1) * step,
      english,
    }));
  }

  return timed
    .sort((a, b) => a.start - b.start)
    .map((line, index, lines) => ({
      ...line,
      id: crypto.randomUUID(),
      end: lines[index + 1]?.start ?? Math.max(line.start + 4, fallbackDuration),
    }));
}

export function formatTime(value: number) {
  if (!Number.isFinite(value)) return "0:00";
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function normalizeAnswer(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function answerScore(answer: string, target: string) {
  const a = normalizeAnswer(answer);
  const b = normalizeAnswer(target);
  if (!a && !b) return 100;
  if (!a || !b) return 0;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }

  return Math.max(0, Math.round((1 - previous[b.length] / Math.max(a.length, b.length)) * 100));
}

