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
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90000),
      });
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 900));
    }
  }
  throw lastError;
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

Return only valid JSON shaped exactly as:
{"mood":"곡 전체 분위기를 나타내는 짧은 한국어 구절","translations":["..."],"studyNotes":[null,"짧은 메모"]}`,
        },
        {
          role: "user",
          content: `Return JSON. Song: ${title ?? "Unknown"} — ${artist ?? "Unknown"}
Full song (${lyrics.length} lines):
${lyrics.map((line, index) => `${index + 1}. ${line}`).join("\n")}

Confirmed translations from earlier batches:
${confirmed || "None yet"}

Translate only lines ${startIndex + 1} through ${endIndex}. Return exactly ${batchLyrics.length} translations and ${batchLyrics.length} studyNotes in that order.`,
        },
      ],
    });
  } catch {
    return NextResponse.json(
      { error: "DeepSeek 서버 연결 시간이 초과됐습니다. 이미 받은 번역은 저장되어 있으니 잠시 뒤 다시 누르면 이어집니다.", code: "UPSTREAM_TIMEOUT" },
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
    const parsed = JSON.parse(content) as { mood?: string; translations?: unknown[]; studyNotes?: unknown[] };
    if (!Array.isArray(parsed.translations) || parsed.translations.length !== batchLyrics.length) {
      throw new Error("line count mismatch");
    }
    const notes = Array.isArray(parsed.studyNotes) && parsed.studyNotes.length === batchLyrics.length
      ? parsed.studyNotes.map((note) => (typeof note === "string" && note.trim() ? note.trim() : null))
      : batchLyrics.map(() => null);

    const canonical = new Map<string, { translation: string; note: string | null }>();
    lyrics.forEach((line, index) => {
      const translation = existingTranslations[index];
      if (translation) canonical.set(normalizeLine(line), { translation, note: existingNotes[index] ?? null });
    });

    const translations = parsed.translations.map((translation, batchIndex) => {
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
