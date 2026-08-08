import { NextResponse } from "next/server";

type TranslateRequest = {
  title?: string;
  artist?: string;
  lyrics?: string[];
  startIndex?: number;
  endIndex?: number;
  existingTranslations?: Array<string | null>;
  existingNotes?: Array<string | null>;
};

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

const normalizeLine = (line: string) =>
  line.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

async function requestDeepSeek(apiKey: string, body: Record<string, unknown>) {
  return fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    // Keep each serverless invocation below a 10-second ceiling. Retries happen
    // in the browser as fresh API requests so one invocation never accumulates them.
    signal: AbortSignal.timeout(8500),
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as TranslateRequest;
  const { title, artist, lyrics, existingTranslations = [], existingNotes = [] } = body;
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "DEEPSEEK_API_KEY가 설정되지 않았습니다. .env.local 또는 Vercel 환경 변수에 추가해주세요.", code: "MISSING_KEY" },
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

  let response: Response;
  try {
    response = await requestDeepSeek(apiKey, {
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-pro",
      response_format: { type: "json_object" },
      max_tokens: Math.max(2200, batchLyrics.length * 320),
      messages: [
        {
          role: "system",
          content: `You translate English pop lyrics into Korean for Korean learners of English.

Read the entire song before translating so pronouns, narrative, emotional arc, recurring images, and references remain coherent. Follow this study-first contract:
1. Return exactly one Korean translation for each requested line. Never merge, split, skip, or reorder lines.
2. Translate identical repeated English lines identically. Reuse confirmed translations exactly for identical lines and keep hook terminology stable.
3. Use direct, intuitive Korean that maps back to the English. Use context for accuracy, but never rewrite poetically or add imagery.
4. Preserve the register of slang, contractions, profanity, deliberate nonstandard grammar, dialect, and wordplay. Do not silently correct the English.
5. Add a study note only for slang, idioms, deliberate grammar, wordplay, or cultural references that materially help learning. Use one short Korean sentence or null.
6. Do not censor meaning, quote the English inside the Korean translation, or add general commentary.

Every requested result must carry its absolute 1-based lyric index. Return only valid JSON shaped exactly as:
{"mood":"곡 전체 분위기를 나타내는 짧은 한국어 구절","lines":[{"index":1,"translation":"번역","studyNote":null}]}`,
        },
        {
          role: "user",
          content: `Return JSON. Song: ${title ?? "Unknown"} — ${artist ?? "Unknown"}
Full song (${lyrics.length} lines):
${lyrics.map((line, index) => `${index + 1}. ${line}`).join("\n")}

Confirmed translations from earlier batches:
${confirmed || "None yet"}

Translate only lines ${startIndex + 1} through ${endIndex}. Return exactly ${batchLyrics.length} objects in the lines array, using the original absolute line numbers ${startIndex + 1} through ${endIndex}.`,
        },
      ],
    });
  } catch {
    return NextResponse.json(
      { error: "DeepSeek 연결 시간이 초과됐습니다. 같은 8줄을 새 요청으로 다시 시도합니다.", code: "UPSTREAM_TIMEOUT" },
      { status: 504 },
    );
  }

  let data: DeepSeekResponse;
  try {
    data = (await response.json()) as DeepSeekResponse;
  } catch {
    return NextResponse.json({ error: "DeepSeek가 읽을 수 없는 응답을 반환했습니다." }, { status: 502 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: data.error?.message ?? "DeepSeek 번역 요청에 실패했습니다." }, { status: response.status });
  }

  try {
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("empty content");
    const jsonStart = content.indexOf("{");
    const jsonEnd = content.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd <= jsonStart) throw new Error("missing json object");
    const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1)) as {
      mood?: string;
      lines?: Array<{ index?: unknown; translation?: unknown; studyNote?: unknown; note?: unknown }>;
      translations?: unknown[];
      studyNotes?: unknown[];
    };

    const rawTranslations: unknown[] = Array(batchLyrics.length).fill(undefined);
    const rawNotes: unknown[] = Array(batchLyrics.length).fill(null);

    if (Array.isArray(parsed.lines)) {
      for (const item of parsed.lines) {
        const absoluteIndex = typeof item.index === "number" ? item.index - 1 : Number(item.index) - 1;
        if (!Number.isInteger(absoluteIndex) || absoluteIndex < startIndex || absoluteIndex >= endIndex) continue;
        const batchIndex = absoluteIndex - startIndex;
        rawTranslations[batchIndex] = item.translation;
        rawNotes[batchIndex] = item.studyNote ?? item.note ?? null;
      }
    } else if (Array.isArray(parsed.translations)) {
      // Some models still return the legacy array shape. Accept either the requested
      // batch or a full-song array and select the requested range deterministically.
      const returnedFullSong = parsed.translations.length === lyrics.length;
      const sourceTranslations = returnedFullSong
        ? parsed.translations.slice(startIndex, endIndex)
        : parsed.translations;
      const sourceNotes = Array.isArray(parsed.studyNotes)
        ? returnedFullSong
          ? parsed.studyNotes.slice(startIndex, endIndex)
          : parsed.studyNotes
        : [];
      sourceTranslations.slice(0, batchLyrics.length).forEach((value, index) => {
        rawTranslations[index] = value;
        rawNotes[index] = sourceNotes[index] ?? null;
      });
    }

    const missingCount = rawTranslations.filter((value) => typeof value !== "string" || !value.trim()).length;
    if (missingCount > 0) {
      const receivedCount = batchLyrics.length - missingCount;
      return NextResponse.json(
        { error: `DeepSeek 응답에서 요청한 ${batchLyrics.length}줄 중 ${receivedCount}줄만 확인됐습니다. 다시 누르면 같은 구간을 재시도합니다.`, code: "PARTIAL_BATCH" },
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
      mood: parsed.mood ?? "",
    });
  } catch {
    return NextResponse.json({ error: "번역 응답의 문장 수가 요청한 구간과 맞지 않습니다. 다시 시도해주세요." }, { status: 502 });
  }
}
