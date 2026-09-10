import { NextResponse } from "next/server";

import { OpenAIRequestError, requestStructuredOpenAI, resolveOpenAIApiKey } from "@/lib/openai-responses";

export const maxDuration = 60;

type MergeRequest = {
  title?: string;
  artist?: string;
  lyrics?: Array<{ start?: number; end?: number; english?: string }>;
  apiKey?: string;
  model?: string;
};

type LyricInput = { start: number; end: number; english: string };
type MergeSuggestion = { after: number; reason: string };
type MergeOutput = { mergeAfter: number[] };

const MAX_STUDY_WORDS = 14;
const MAX_STUDY_CHARS = 96;
const MAX_STUDY_SECONDS = 10;

const isSectionLine = (english: string) => /^\[[^\]]+\]$/.test(english.trim());
const incompleteEnding = /\b(?:a|an|the|to|of|for|with|from|about|into|on|in|at|by|as|than|and|but|or|because|cause|cuz|cos|if|when|whenever|while|that|who|which|where|is|are|was|were|be|been|being|do|does|did|have|has|had|can|can't|cannot|could|couldn't|will|won't|would|wouldn't|shall|should|shouldn't|may|might|must|feel|feels|feeling|like|want|wanna|wanted|need|needed|try|trying|make|makes|made|let|keep|keeps|start|started|stop|stopped|look|looking|wait|waiting|swear|promise|hope|think|know|say|tell)$/i;
const continuationStart = /^(?:to|of|for|with|from|about|into|onto|on|in|at|by|as|than|because|cause|cuz|cos|if|when|while|that|who|which|where|without|through|over|under)\b/i;
const terminalPunctuation = /[.!?…]["'’)]?$/;

const cleanLeftBoundary = (english: string) => english
  .replace(/\s*\((?:yo|uh-?huh|yeah|oh|woah|ooh|mm+|ayy)[^)]*\)\s*[,;:]?\s*$/i, "")
  .replace(/[,;:—–\-\s]+$/g, "");
const cleanRightBoundary = (english: string) => english.replace(/^[\s("'‘’]+/, "");
const normalizedLine = (english: string) => english.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9'\s]/g, " ").replace(/\s+/g, " ").trim();

function isHardSafeMergeBoundary(lyrics: LyricInput[], after: number) {
  const left = lyrics[after - 1];
  const right = lyrics[after];
  if (!left || !right || isSectionLine(left.english) || isSectionLine(right.english)) return false;
  if (terminalPunctuation.test(left.english)) return false;
  if (normalizedLine(left.english) === normalizedLine(right.english)) return false;
  return true;
}

function conservativeFallbackMerges(lyrics: LyricInput[]) {
  const merges: MergeSuggestion[] = [];
  for (let index = 0; index < lyrics.length - 1; index += 1) {
    const left = lyrics[index];
    const right = lyrics[index + 1];
    if (!isHardSafeMergeBoundary(lyrics, index + 1)) continue;

    const leftForGrammar = cleanLeftBoundary(left.english);
    const rightForGrammar = cleanRightBoundary(right.english);
    const rightStartsLikeContinuation = continuationStart.test(rightForGrammar);
    const rightStartsLowerConnector = /^(?:and|but|or)\b/.test(rightForGrammar);
    const leftNeedsCompletion = incompleteEnding.test(leftForGrammar);

    if (rightStartsLikeContinuation || rightStartsLowerConnector || leftNeedsCompletion) {
      merges.push({ after: index + 1, reason: "로컬 문법 규칙으로 이어지는 구간" });
    }
  }
  return merges;
}

function enforceStudyUnitLimits(lyrics: LyricInput[], candidates: number[]) {
  const requested = new Set(candidates);
  const accepted: number[] = [];
  let groupStart = 0;

  for (let after = 1; after < lyrics.length; after += 1) {
    if (!requested.has(after) || !isHardSafeMergeBoundary(lyrics, after)) {
      groupStart = after;
      continue;
    }

    const group = lyrics.slice(groupStart, after + 1);
    const text = group.map((line) => line.english.trim()).join(" ").replace(/\s+/g, " ");
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const duration = Math.max(0, group.at(-1)!.end - group[0].start);
    const leftNeedsCompletion = incompleteEnding.test(cleanLeftBoundary(lyrics[after - 1].english));
    const slightlyExtendedForRequiredCompletion = leftNeedsCompletion && wordCount <= MAX_STUDY_WORDS + 2 && text.length <= MAX_STUDY_CHARS + 16;

    if (
      (wordCount <= MAX_STUDY_WORDS && text.length <= MAX_STUDY_CHARS && duration <= MAX_STUDY_SECONDS)
      || slightlyExtendedForRequiredCompletion
    ) {
      accepted.push(after);
    } else {
      groupStart = after;
    }
  }

  return accepted;
}

export async function POST(request: Request) {
  const body = (await request.json()) as MergeRequest;
  const apiKey = resolveOpenAIApiKey(body.apiKey);
  const lyrics = Array.isArray(body.lyrics)
    ? body.lyrics.map((line) => ({
      start: Number(line.start),
      end: Number(line.end),
      english: typeof line.english === "string" ? line.english.trim() : "",
    }))
    : [];

  if (!apiKey) {
    return NextResponse.json(
      { error: "OpenAI API 키가 없습니다. 설정에서 API 키를 저장하거나 OPENAI_API_KEY 환경 변수를 추가해주세요.", code: "MISSING_KEY" },
      { status: 503 },
    );
  }
  if (lyrics.length < 2 || lyrics.length > 300 || lyrics.some((line) => !line.english)) {
    return NextResponse.json({ error: "분석할 가사는 2~300줄이어야 합니다." }, { status: 400 });
  }
  if (lyrics.map((line) => line.english).join("\n").length > 30000) {
    return NextResponse.json({ error: "가사가 너무 깁니다." }, { status: 400 });
  }

  const schema = {
    type: "object",
    properties: {
      mergeAfter: {
        type: "array",
        items: { type: "integer" },
      },
    },
    required: ["mergeAfter"],
    additionalProperties: false,
  };

  try {
    const result = await requestStructuredOpenAI<MergeOutput>({
      apiKey,
      model: body.model,
      schemaName: "popover_study_unit_boundaries",
      schema,
      reasoningEffort: "medium",
      maxOutputTokens: 4000,
      timeoutMs: 50000,
      system: `You create practical English listening/dictation units from karaoke-timed lyric lines.

The source lines are display fragments, not reliable English sentence boundaries. Your output says which EXISTING boundaries should be removed. You cannot create a new boundary inside one source line.

The objective is not to reconstruct the longest grammatically complete sentence. The objective is a natural, repeatable study unit that a learner can hear and type without fatigue.

Rules:
1. MERGE when a source line is an awkward fragment and the next line supplies a required object, complement, infinitive, prepositional phrase, subordinate clause, or shared-subject predicate.
2. KEEP a boundary when both sides work as independently hearable clauses, even if they belong to one larger grammatical sentence.
3. Prefer roughly 4-10 words per resulting study unit. Do not intentionally create a unit above 14 words. If a full sentence is longer, keep a sensible clause boundary instead of merging the entire sentence.
4. Never cross [Verse], [Chorus], speaker labels, a repeated hook boundary, call-and-response, or a clear sentence change.
5. Do not merge identical repeated lines.
6. A line ending in terminal punctuation is normally a hard stop.
7. Consider the whole song so repeated structures are treated consistently.

Examples:
- MERGE "Today I don't feel" / "like doing anything"
- KEEP "I just wanna lay in my bed" by itself
- MERGE "Don't feel like" / "picking up my phone"
- MERGE "So leave a message" / "at the tone"
- MERGE "'Cause today I swear" / "I'm not doing anything"
- MERGE "I'm gonna kick my feet up" / "and stare at the fan" only when the resulting unit remains comfortable
- KEEP "You know you love me" / "I know you care"
- KEEP repeated hook lines such as "Baby, baby, baby" / "Like baby, baby, baby"

Return mergeAfter only. If boundary N is removed, line N and line N+1 become one unit.`,
      user: `Song: ${body.title?.trim() || "Unknown"} — ${body.artist?.trim() || "Unknown"}

Return every karaoke boundary that should be removed:
${lyrics.map((line, index) => `${index + 1}. [${Number.isFinite(line.start) ? line.start.toFixed(3) : "?"}-${Number.isFinite(line.end) ? line.end.toFixed(3) : "?"}] ${line.english}`).join("\n")}`,
    });

    const candidates = result.data.mergeAfter
      .map(Number)
      .filter((after) => Number.isInteger(after) && after >= 1 && after < lyrics.length && isHardSafeMergeBoundary(lyrics, after));
    const accepted = enforceStudyUnitLimits(lyrics, candidates);
    const merges = [...new Set(accepted)]
      .sort((a, b) => a - b)
      .map((after) => ({ after, reason: "GPT 학습 문장 분석" }));

    return NextResponse.json({ merges, fallback: false, model: result.model });
  } catch (error) {
    if (error instanceof OpenAIRequestError && error.code === "OPENAI_API_ERROR") {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }

    const fallbackCandidates = conservativeFallbackMerges(lyrics);
    const accepted = enforceStudyUnitLimits(lyrics, fallbackCandidates.map((item) => item.after));
    const fallbackMap = new Map(fallbackCandidates.map((item) => [item.after, item]));
    const merges = accepted.map((after) => fallbackMap.get(after) ?? { after, reason: "로컬 문법 규칙" });

    return NextResponse.json({
      merges,
      fallback: true,
      warning: error instanceof Error ? error.message : "GPT 분석을 사용할 수 없어 로컬 규칙을 사용했습니다.",
    });
  }
}
