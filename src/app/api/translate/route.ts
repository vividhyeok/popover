import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { title, artist, lyrics } = (await request.json()) as {
    title?: string;
    artist?: string;
    lyrics?: string[];
  };
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

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-pro",
      response_format: { type: "json_object" },
      max_tokens: 12000,
      messages: [
        {
          role: "system",
          content:
            `You translate English pop lyrics into Korean for Korean learners of English.

Read the entire song before translating so pronouns, narrative, emotional arc, recurring images, and references remain coherent. Follow this study-first translation contract:
1. Keep exactly one Korean translation for each English input line. Never merge, split, skip, or reorder lines.
2. Translate identical repeated English lines identically. Keep near-repeated hooks and motifs terminologically consistent unless their actual meaning changes.
3. Use a direct, intuitive Korean rendering that lets a learner map the Korean meaning back to the English. Preserve necessary context, but do not rewrite poetically or add imagery not present in the original.
4. Preserve the intent and register of slang, contractions, profanity, deliberate nonstandard grammar, dialect, and wordplay. Do not silently 'correct' the English.
5. Put explanations only in studyNotes, and only when a line contains slang, an idiom, deliberate grammar, wordplay, or a cultural reference that materially helps learning. Each note must be one short Korean sentence or null. Do not explain ordinary vocabulary.
6. Do not censor meaning, quote the English in the Korean translation, or add general commentary.

Return only a valid JSON object shaped exactly as:
{"mood":"곡 전체 분위기를 나타내는 짧은 한국어 구절","translations":["..."],"studyNotes":[null,"짧은 메모"]}`,
        },
        {
          role: "user",
          content: `Return JSON. Song: ${title ?? "Unknown"} — ${artist ?? "Unknown"}\nLine count: ${lyrics.length}\nLyrics:\n${lyrics
            .map((line, index) => `${index + 1}. ${line}`)
            .join("\n")}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });

  const data = await response.json();
  if (!response.ok) {
    return NextResponse.json({ error: data?.error?.message ?? "DeepSeek 번역 요청에 실패했습니다." }, { status: response.status });
  }

  try {
    const content = data.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed.translations) || parsed.translations.length !== lyrics.length) {
      throw new Error("line count mismatch");
    }
    const notes = Array.isArray(parsed.studyNotes) && parsed.studyNotes.length === lyrics.length
      ? parsed.studyNotes.map((note: unknown) => (typeof note === "string" && note.trim() ? note.trim() : null))
      : lyrics.map(() => null);

    // Chorus lines are commonly repeated verbatim. Enforce stable study mappings even if
    // a model sample drifts between occurrences.
    const repeated = new Map<string, { translation: string; note: string | null }>();
    const translations = parsed.translations.map((translation: unknown, index: number) => {
      if (typeof translation !== "string" || !translation.trim()) throw new Error("invalid translation");
      const key = lyrics[index].toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
      const existing = repeated.get(key);
      if (existing) {
        notes[index] = existing.note;
        return existing.translation;
      }
      repeated.set(key, { translation: translation.trim(), note: notes[index] });
      return translation.trim();
    });

    return NextResponse.json({ translations, studyNotes: notes, mood: parsed.mood ?? "" });
  } catch {
    return NextResponse.json({ error: "번역 응답의 문장 수가 원문과 맞지 않습니다. 다시 시도해주세요." }, { status: 502 });
  }
}
