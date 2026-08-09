import { NextResponse } from "next/server";

export const maxDuration = 30;

type MergeRequest = {
  title?: string;
  artist?: string;
  lyrics?: Array<{ start?: number; end?: number; english?: string }>;
};

type LyricInput = { start: number; end: number; english: string };
type MergeSuggestion = { after: number; reason: string };
type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

const CHUNK_SIZE = 32;
const CHUNK_OVERLAP = 2;

const isSectionLine = (english: string) => /^\[[^\]]+\]$/.test(english.trim());
const incompleteEnding = /\b(?:a|an|the|to|of|for|with|from|about|into|on|in|at|by|as|than|and|but|or|because|cause|cuz|cos|if|when|whenever|while|that|who|which|where|is|are|was|were|be|been|being|do|does|did|have|has|had|can|can't|cannot|could|couldn't|will|won't|would|wouldn't|shall|should|shouldn't|may|might|must|feel|feels|feeling|like|want|wanna|wanted|need|needed|try|trying|make|makes|made|let|keep|keeps|start|started|stop|stopped|look|looking|wait|waiting|swear|promise|hope|think|know|say|tell)$/i;
const continuationStart = /^(?:to|of|for|with|from|about|into|onto|on|in|at|by|as|than|because|cause|cuz|cos|if|when|while|that|who|which|where|without|through|over|under)\b/i;
const terminalPunctuation = /[.!?…]["'’)]?$/;

const cleanLeftBoundary = (english: string) => english
  .replace(/\s*\((?:yo|uh-?huh|yeah|oh|woah|ooh|mm+|ayy)[^)]*\)\s*[,;:]?\s*$/i, "")
  .replace(/[,;:—–\-\s]+$/g, "");
const cleanRightBoundary = (english: string) => english.replace(/^[\s("'‘’]+/, "");
const normalizedLine = (english: string) => english.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9'\s]/g, " ").replace(/\s+/g, " ").trim();

function isSafeMergeBoundary(lyrics: LyricInput[], after: number) {
  const left = lyrics[after - 1];
  const right = lyrics[after];
  if (!left || !right || isSectionLine(left.english) || isSectionLine(right.english)) return false;
  if (terminalPunctuation.test(left.english) || normalizedLine(left.english) === normalizedLine(right.english)) return false;

  const leftNeedsCompletion = incompleteEnding.test(cleanLeftBoundary(left.english));
  const rightText = cleanRightBoundary(right.english);
  const startsNewClause = /^(?:i|i'm|i'll|i'd|you|you're|you'll|you'd|we|we're|we'll|we'd|he|he's|she|she's|they|they're|it|it's|there|there's|this|these|those|what|why|how)\b/i.test(rightText);
  const startsConnectorWithNewSubject = /^(?:and|but|or)\s+(?:i|you|we|he|she|they|it|there|this|these|those)\b/i.test(rightText);
  const startsSharedPredicate = /^(?:and|but|or)\s+(?!i\b|you\b|we\b|he\b|she\b|they\b|it\b|there\b|this\b|these\b|those\b)/i.test(rightText);
  const startsCapitalizedUnit = /^[A-Z]/.test(rightText) && !continuationStart.test(rightText) && !startsSharedPredicate;
  const startsLikeHook = /^like\b/i.test(rightText);
  return leftNeedsCompletion || (!startsNewClause && !startsConnectorWithNewSubject && !startsCapitalizedUnit && !startsLikeHook);
}

function conservativeFallbackMerges(lyrics: LyricInput[]) {
  const merges: MergeSuggestion[] = [];

  for (let index = 0; index < lyrics.length - 1; index += 1) {
    const left = lyrics[index];
    const right = lyrics[index + 1];
    if (isSectionLine(left.english) || isSectionLine(right.english) || terminalPunctuation.test(left.english)) continue;

    const leftForGrammar = cleanLeftBoundary(left.english);
    const rightForGrammar = cleanRightBoundary(right.english);
    const rightStartsLikeContinuation = continuationStart.test(rightForGrammar);
    const rightStartsLowerConnector = /^(?:and|but|or)\b/.test(rightForGrammar);
    const leftNeedsCompletion = incompleteEnding.test(leftForGrammar);

    if ((rightStartsLikeContinuation || rightStartsLowerConnector || leftNeedsCompletion) && isSafeMergeBoundary(lyrics, index + 1)) {
      merges.push({ after: index + 1, reason: "문법·의미상 같은 문장의 직접적인 이어짐" });
    }
  }
  return merges;
}

function createChunks(length: number) {
  if (length <= CHUNK_SIZE) return [{ start: 0, end: length }];
  const chunks: Array<{ start: number; end: number }> = [];
  const step = CHUNK_SIZE - CHUNK_OVERLAP;
  for (let start = 0; start < length; start += step) {
    const end = Math.min(length, start + CHUNK_SIZE);
    chunks.push({ start, end });
    if (end === length) break;
  }
  return chunks;
}

function parseMergeIndexes(content: string) {
  const jsonStart = content.indexOf("{");
  const jsonEnd = content.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd <= jsonStart) throw new Error("DeepSeek가 JSON을 반환하지 않았습니다.");
  const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1)) as {
    mergeAfter?: unknown[];
    merges?: Array<{ after?: unknown }>;
  };
  if (Array.isArray(parsed.mergeAfter)) return parsed.mergeAfter.map(Number);
  if (Array.isArray(parsed.merges)) return parsed.merges.map((item) => Number(item.after));
  throw new Error("DeepSeek 응답에 병합 경계가 없습니다.");
}

async function requestDeepSeekChunk(
  apiKey: string,
  model: string,
  body: MergeRequest,
  lyrics: LyricInput[],
  chunk: { start: number; end: number },
) {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 320,
      messages: [
        {
          role: "system",
          content: `You reconstruct practical sentence units for an English lyric dictation app.

The source is often split for karaoke display, not by English sentence structure. Remove only boundaries that leave an unusable grammatical fragment. Each resulting unit must stay short enough to hear, loop, and type comfortably. Lyric feeds often omit punctuation, but a line with its own subject and finite predicate is normally a complete dictation unit.

MERGE when either side is an awkward fragment, or when the next line supplies a required object, complement, infinitive, prepositional phrase, subordinate clause, or shared-subject compound predicate. KEEP separate when both lines have their own subject and predicate, even if they are connected by commas, rhyme, narrative flow, or "and".

Required examples:
- MERGE "Today I don't feel" / "like doing anything"
- KEEP "I just wanna lay in my bed" by itself
- MERGE "Don't feel like" / "picking up my phone"
- MERGE "So leave a message" / "at the tone"
- MERGE "'Cause today I swear" / "I'm not doing anything"
- MERGE "I'm gonna kick my feet up" / "and stare at the fan"
- KEEP "You know you love me" / "I know you care"
- KEEP "You are my love" / "you are my heart"
- KEEP "you are my heart" / "And we will never be apart"
- KEEP repeated "Baby, baby, baby" / "Like baby, baby, baby" hook lines

Never join several short but complete clauses into one long unit. Never cross [Verse], [Chorus], speaker labels, repeated hooks, call-and-response, or a clear sentence change. The number of source display lines is irrelevant: remove every boundary inside one genuine sentence, and stop exactly where that sentence ends.

Line numbers are the original song-wide numbers. Return only compact valid JSON such as {"mergeAfter":[1,4,6]}. A number means remove the boundary after that original line. Return {"mergeAfter":[]} when none should be removed. Do not return reasons or prose.`,
        },
        {
          role: "user",
          content: `Song: ${body.title?.trim() || "Unknown"} — ${body.artist?.trim() || "Unknown"}

This is lines ${chunk.start + 1}-${chunk.end} of the song. Return every karaoke-style boundary in this excerpt that should be removed:
${lyrics.slice(chunk.start, chunk.end).map((line, index) => `${chunk.start + index + 1}. [${Number.isFinite(line.start) ? line.start.toFixed(3) : "?"}-${Number.isFinite(line.end) ? line.end.toFixed(3) : "?"}] ${line.english}`).join("\n")}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(25000),
  });

  const data = (await response.json()) as DeepSeekResponse;
  if (!response.ok) throw new Error(data.error?.message ?? "DeepSeek 가사 구조 분석에 실패했습니다.");
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek가 빈 응답을 반환했습니다.");

  return parseMergeIndexes(content).filter((after) =>
    Number.isInteger(after)
    && after >= chunk.start + 1
    && after < chunk.end
    && isSafeMergeBoundary(lyrics, after),
  );
}

export async function POST(request: Request) {
  const body = (await request.json()) as MergeRequest;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const lyrics = Array.isArray(body.lyrics)
    ? body.lyrics.map((line) => ({
      start: Number(line.start),
      end: Number(line.end),
      english: typeof line.english === "string" ? line.english.trim() : "",
    }))
    : [];

  if (!apiKey) {
    return NextResponse.json(
      { error: "DEEPSEEK_API_KEY가 설정되지 않았습니다. .env.local 또는 Vercel 환경 변수에 추가해주세요.", code: "MISSING_KEY" },
      { status: 503 },
    );
  }
  if (lyrics.length < 2 || lyrics.length > 300 || lyrics.some((line) => !line.english)) {
    return NextResponse.json({ error: "분석할 가사는 2~300줄이어야 합니다." }, { status: 400 });
  }
  if (lyrics.map((line) => line.english).join("\n").length > 30000) {
    return NextResponse.json({ error: "가사가 너무 깁니다." }, { status: 400 });
  }

  const chunks = createChunks(lyrics.length);
  const results = await Promise.allSettled(
    chunks.map((chunk) => requestDeepSeekChunk(
      apiKey,
      process.env.DEEPSEEK_MERGE_MODEL ?? process.env.DEEPSEEK_MODEL ?? "deepseek-v4-pro",
      body,
      lyrics,
      chunk,
    )),
  );
  const failedChunks = results.filter((result) => result.status === "rejected").length;
  const seen = new Set<number>();
  const merges: MergeSuggestion[] = [];

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const after of result.value) {
      if (seen.has(after)) continue;
      seen.add(after);
      merges.push({ after, reason: "DeepSeek 문장 구조 분석" });
    }
  }
  for (const safeMerge of conservativeFallbackMerges(lyrics)) {
    if (seen.has(safeMerge.after)) continue;
    seen.add(safeMerge.after);
    merges.push(safeMerge);
  }

  merges.sort((a, b) => a.after - b.after);
  return NextResponse.json({ merges, fallback: failedChunks > 0, analyzedChunks: chunks.length - failedChunks, totalChunks: chunks.length });
}
