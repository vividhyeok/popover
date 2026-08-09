import type { LyricLine } from "./types";

export type LyricMergeSuggestion = {
  after: number;
  reason?: string;
};

export type MergedLyricGroup = {
  sourceIds: string[];
  sourceIndexes: number[];
  english: string;
};

const isSectionLine = (english: string) => /^\[[^\]]+\]$/.test(english.trim());

export function mergeLyricLines(lines: LyricLine[], suggestions: LyricMergeSuggestion[]) {
  const requestedBoundaries = new Set(
    suggestions
      .map((suggestion) => Math.floor(suggestion.after))
      .filter((after) => after >= 1 && after < lines.length),
  );
  const lyrics: LyricLine[] = [];
  const mergedGroups: MergedLyricGroup[] = [];

  for (let index = 0; index < lines.length;) {
    const group = [lines[index]];
    const sourceIndexes = [index];
    let cursor = index;

    while (requestedBoundaries.has(cursor + 1) && cursor + 1 < lines.length) {
      const next = lines[cursor + 1];
      if (
        isSectionLine(group.at(-1)?.english ?? "")
        || isSectionLine(next.english)
      ) break;
      group.push(next);
      cursor += 1;
      sourceIndexes.push(cursor);
    }

    if (group.length === 1) {
      lyrics.push(group[0]);
    } else {
      const english = group.map((line) => line.english.trim()).join(" ").replace(/\s+/g, " ");
      const koreanParts = group.map((line) => line.korean?.trim()).filter((value): value is string => Boolean(value));
      const noteParts = [...new Set(group.map((line) => line.note?.trim()).filter((value): value is string => Boolean(value)))];
      lyrics.push({
        ...group[0],
        end: group.at(-1)?.end ?? group[0].end,
        english,
        korean: koreanParts.length ? koreanParts.join(" ") : undefined,
        note: noteParts.length ? noteParts.join(" · ") : undefined,
      });
      mergedGroups.push({ sourceIds: group.map((line) => line.id), sourceIndexes, english });
    }
    index = cursor + 1;
  }

  return { lyrics, mergedGroups };
}
