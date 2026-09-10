import { NextResponse } from "next/server";

import { OpenAIRequestError, requestStructuredOpenAI, resolveOpenAIApiKey } from "@/lib/openai-responses";

export const maxDuration = 60;

type TranslateRequest = {
  title?: string;
  artist?: string;
  lyrics?: string[];
  startIndex?: number;
  endIndex?: number;
  existingTranslations?: Array<string | null>;
  existingNotes?: Array<string | null>;
  apiKey?: string;
  model?: string;
};

type TranslationOutput = {
  mood: string;
  lines: Array<{
    index: number;
    translation: string;
    studyNote: string | null;
  }>;
};

const normalizeLine = (line: string) =>
  line.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

export async function POST(request: Request) {
  const body = (await request.json()) as TranslateRequest;
  const { title, artist, lyrics, existingTranslations = [], existingNotes = [] } = body;
  const apiKey = resolveOpenAIApiKey(body.apiKey);

  if (!apiKey) {
    return NextResponse.json(
      { error: "OpenAI API 키가 없습니다. 설정에서 API 키를 저장하거나 OPENAI_API_KEY 환경 변수를 추가해주세요.", code: "MISSING_KEY" },
      { status: 503 },
    );
  }
  if (!Array.isArray(lyrics) || lyrics.length === 0 || lyrics.length > 300) {
    return NextResponse.json({ error: "번역할 가사는 1~300줄이어야 합니다." }, { status: 400 });
  }
  if (lyrics.join("\n").length > 30000) {
    return NextResponse.json({ error: "가사가 너무 깁니다." }, { status: 400 });
  }

  const startIndex = Math.max(0, Math.min(Math.floor(body.startIndex ?? 0), lyrics.length - 1));
  const endIndex = Math.max(startIndex + 1, Math.min(Math.floor(body.endIndex ?? lyrics.length), lyrics.length));
  const batchLyrics = lyrics.slice(startIndex, endIndex);
  const confirmed = lyrics
    .map((line, index) => {
      const translation = existingTranslations[index];
      if (!translation) return null;
      const note = existingNotes[index] ? ` / NOTE: ${existingNotes[index]}` : "";
      return `${index + 1}. ${line} => ${translation}${note}`;
    })
    .filter(Boolean)
    .join("\n");

  const schema = {
    type: "object",
    properties: {
      mood: { type: "string" },
      lines: {
        type: "array",
        minItems: batchLyrics.length,
        maxItems: batchLyrics.length,
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            translation: { type: "string" },
            studyNote: { type: ["string", "null"] },
          },
          required: ["index", "translation", "studyNote"],
          additionalProperties: false,
        },
      },
    },
    required: ["mood", "lines"],
    additionalProperties: false,
  };

  try {
    const result = await requestStructuredOpenAI<TranslationOutput>({
      apiKey,
      model: body.model,
      schemaName: "popover_lyric_translation",
      schema,
      reasoningEffort: "low",
      maxOutputTokens: Math.min(16000, Math.max(3000, batchLyrics.length * 360)),
      timeoutMs: 50000,
      system: `You are the Korean translation engine for an English-pop listening and dictation study app.

Read the ENTIRE song before translating the requested lines. Resolve pronouns, speaker/addressee, narrative, emotional arc, repeated imagery, slang, and references from full-song context. This is an English-learning translation, not a literary rewrite.

Rules:
1. Return exactly one Korean translation for every requested lyric line. Never merge, split, skip, duplicate, or reorder requested lines.
2. Translate identical repeated English lines identically. Reuse confirmed translations exactly for identical lines and keep recurring hooks and terminology stable.
3. Write direct, natural Korean that lets a learner map the Korean back to the English. Use context to disambiguate, but do not add information that is absent from the lyric.
4. Preserve register and intent: slang, contractions, profanity, dialect, deliberate nonstandard grammar, jokes, and wordplay should remain recognizable rather than being sanitized.
5. studyNote must be null unless an idiom, slang expression, deliberate grammar, wordplay, pronunciation-linked contraction, or cultural reference materially helps English study. When needed, write one compact Korean sentence.
6. Do not quote the full English line inside translation or studyNote. Do not add general commentary.
7. Every result must use the original absolute 1-based lyric index supplied by the user.`,
      user: `Song: ${title ?? "Unknown"} — ${artist ?? "Unknown"}

FULL SONG (${lyrics.length} lines; context only):
${lyrics.map((line, index) => `${index + 1}. ${line}`).join("\n")}

CONFIRMED TRANSLATIONS FROM EARLIER BATCHES:
${confirmed || "None yet"}

Translate ONLY lines ${startIndex + 1} through ${endIndex}. Return exactly ${batchLyrics.length} line objects using absolute indexes ${startIndex + 1} through ${endIndex}.`,
    });

    const rawTranslations: unknown[] = Array(batchLyrics.length).fill(undefined);
    const rawNotes: unknown[] = Array(batchLyrics.length).fill(null);

    for (const item of result.data.lines) {
      const absoluteIndex = Number(item.index) - 1;
      if (!Number.isInteger(absoluteIndex) || absoluteIndex < startIndex || absoluteIndex >= endIndex) continue;
      const batchIndex = absoluteIndex - startIndex;
      rawTranslations[batchIndex] = item.translation;
      rawNotes[batchIndex] = item.studyNote;
    }

    const missingCount = rawTranslations.filter((value) => typeof value !== "string" || !value.trim()).length;
    if (missingCount > 0) {
      return NextResponse.json(
        { error: `OpenAI 응답에서 요청한 ${batchLyrics.length}줄 중 ${batchLyrics.length - missingCount}줄만 확인됐습니다. 같은 구간을 다시 시도해주세요.`, code: "PARTIAL_BATCH" },
        { status: 502 },
      );
    }

    const notes = rawNotes.map((note) => (typeof note === "string" && note.trim() ? note.trim() : null));
    const canonical = new Map<string, { translation: string; note: string | null }>();

    lyrics.forEach((line, index) => {
      const translation = existingTranslations[index];
      if (translation) canonical.set(normalizeLine(line), { translation, note: existingNotes[index] ?? null });
    });

    const translations = rawTranslations.map((translation, batchIndex) => {
      if (typeof translation !== "string" || !translation.trim()) throw new Error("invalid translation");
      const key = normalizeLine(batchLyrics[batchIndex]);
      const existing = canonical.get(key);
      if (existing) {
        notes[batchIndex] = existing.note;
        return existing.translation;
      }
      const value = translation.trim();
      canonical.set(key, { translation: value, note: notes[batchIndex] });
      return value;
    });

    return NextResponse.json({
      startIndex,
      endIndex,
      translations,
      studyNotes: notes,
      mood: result.data.mood ?? "",
      model: result.model,
    });
  } catch (error) {
    if (error instanceof OpenAIRequestError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "번역 응답을 처리하지 못했습니다. 다시 시도해주세요." }, { status: 502 });
  }
}
