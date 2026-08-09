import { NextResponse } from "next/server";

type MergeRequest = {
  title?: string;
  artist?: string;
  lyrics?: Array<{ start?: number; end?: number; english?: string }>;
};

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

const isSectionLine = (english: string) => /^\[[^\]]+\]$/.test(english.trim());
const wordCount = (english: string) => english.trim().split(/\s+/).filter(Boolean).length;

function conservativeFallbackMerges(lyrics: Array<{ start: number; end: number; english: string }>) {
  const incompleteEnding = /\b(?:a|an|the|to|of|for|with|from|about|into|on|in|at|by|as|than|and|but|or|because|if|when|while|that|who|which|where|is|are|was|were|be|been|being|do|does|did|have|has|had|can|could|will|would|shall|should|may|might|must|feel|feels|feeling|want|wanna|wanted|need|needed|try|trying|make|makes|made|let|keep|keeps|start|started|stop|stopped|look|looking|wait|waiting)$/i;
  const continuationStart = /^(?:to|of|for|with|from|about|into|on|in|at|by|as|than|and|but|or|because|if|when|while|that|who|which|where|like)\b/i;
  const terminalPunctuation = /[.!?…]["'’)]?$/;
  const merges: Array<{ after: number; reason: string }> = [];

  for (let index = 0; index < lyrics.length - 1; index += 1) {
    const left = lyrics[index];
    const right = lyrics[index + 1];
    if (isSectionLine(left.english) || isSectionLine(right.english) || terminalPunctuation.test(left.english)) continue;
    const combinedWords = wordCount(`${left.english} ${right.english}`);
    const duration = right.end - left.start;
    const rightStartsLikeContinuation = /^[a-z'’(]/.test(right.english) && (continuationStart.test(right.english) || incompleteEnding.test(left.english));
    if (rightStartsLikeContinuation && combinedWords <= 26 && duration <= 18) {
      merges.push({ after: index + 1, reason: "문법적으로 미완성인 앞줄의 직접적인 이어짐" });
    }
  }
  return merges;
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

  let response: Response;
  try {
    response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MERGE_MODEL ?? "deepseek-v4-flash",
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 500,
        messages: [
          {
            role: "system",
            content: `You are a conservative lyric segmentation editor for an English dictation app.

Your only job is to identify adjacent timestamped lyric lines whose boundary makes a single English sentence or indispensable phrase unnaturally impossible to type and loop. Example: "Today I don't feel" / "like doing anything" should be merged because the first line is an incomplete clause and the second completes it.

MERGE only with high confidence when:
- the first line is syntactically incomplete and the next line is its necessary continuation;
- a preposition, infinitive, auxiliary, determiner, conjunction, or tightly bound phrasal expression is stranded by the boundary;
- keeping the split would make either dictation segment misleading or grammatically unusable.

DO NOT merge merely because two lines belong to the same idea, verse, rhyme, or narrative. Preserve intentional lyric line breaks when each line works as a usable spoken unit. Never cross [Verse], [Chorus], speaker labels, repeated hooks, call-and-response, or clear sentence boundaries. Never create a group longer than 3 source lines, 26 English words, or 18 seconds.

Return only valid JSON shaped exactly as:
{"merges":[{"after":1,"reason":"short reason"}]}

"after": 1 means remove the boundary after original line 1 and join original lines 1 and 2. Return {"merges":[]} if no boundary clearly needs removal.`,
          },
          {
            role: "user",
            content: `Song: ${body.title?.trim() || "Unknown"} — ${body.artist?.trim() || "Unknown"}

Review the full song and return only high-confidence boundary removals:
${lyrics.map((line, index) => `${index + 1}. [${Number.isFinite(line.start) ? line.start.toFixed(3) : "?"}-${Number.isFinite(line.end) ? line.end.toFixed(3) : "?"}] ${line.english}`).join("\n")}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(7500),
    });
  } catch {
    return NextResponse.json({ merges: conservativeFallbackMerges(lyrics), fallback: true });
  }

  let data: DeepSeekResponse;
  try {
    data = (await response.json()) as DeepSeekResponse;
  } catch {
    return NextResponse.json({ merges: conservativeFallbackMerges(lyrics), fallback: true });
  }
  if (!response.ok) {
    return NextResponse.json({ error: data.error?.message ?? "DeepSeek 가사 구조 분석에 실패했습니다." }, { status: response.status });
  }

  try {
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("empty response");
    const jsonStart = content.indexOf("{");
    const jsonEnd = content.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd <= jsonStart) throw new Error("missing json");
    const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1)) as { merges?: Array<{ after?: unknown; reason?: unknown }> };
    const seen = new Set<number>();
    const merges = (Array.isArray(parsed.merges) ? parsed.merges : [])
      .map((item) => ({ after: Number(item.after), reason: typeof item.reason === "string" ? item.reason.trim() : "" }))
      .filter((item) => {
        const left = lyrics[item.after - 1];
        const right = lyrics[item.after];
        if (!Number.isInteger(item.after) || item.after < 1 || item.after >= lyrics.length || seen.has(item.after)) return false;
        if (!left || !right || isSectionLine(left.english) || isSectionLine(right.english)) return false;
        seen.add(item.after);
        return true;
      })
      .sort((a, b) => a.after - b.after);
    for (const safeMerge of conservativeFallbackMerges(lyrics)) {
      if (!seen.has(safeMerge.after)) merges.push(safeMerge);
    }
    merges.sort((a, b) => a.after - b.after);
    return NextResponse.json({ merges });
  } catch {
    return NextResponse.json({ merges: conservativeFallbackMerges(lyrics), fallback: true });
  }
}
