import { NextResponse } from "next/server";

import { OpenAIRequestError, requestStructuredOpenAI, resolveOpenAIApiKey } from "@/lib/openai-responses";

type MetadataRequest = {
  title?: string;
  channel?: string;
  apiKey?: string;
};

type MetadataOutput = {
  title: string;
  artist: string;
  searchQuery: string;
  confidence: number;
};

export const maxDuration = 20;

export async function POST(request: Request) {
  const body = (await request.json()) as MetadataRequest;
  const rawTitle = body.title?.trim() ?? "";
  const rawChannel = body.channel?.trim() ?? "";
  const apiKey = resolveOpenAIApiKey(body.apiKey);

  if (!rawTitle) {
    return NextResponse.json({ error: "YouTube 제목이 없습니다." }, { status: 400 });
  }
  if (!apiKey) {
    return NextResponse.json(
      { error: "OpenAI API 키가 없어 음악 메타데이터를 정제하지 못했습니다.", code: "MISSING_KEY" },
      { status: 503 },
    );
  }
  if (rawTitle.length > 500 || rawChannel.length > 200) {
    return NextResponse.json({ error: "YouTube 메타데이터가 너무 깁니다." }, { status: 400 });
  }

  const schema = {
    type: "object",
    properties: {
      title: { type: "string" },
      artist: { type: "string" },
      searchQuery: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["title", "artist", "searchQuery", "confidence"],
    additionalProperties: false,
  };

  try {
    const result = await requestStructuredOpenAI<MetadataOutput>({
      apiKey,
      model: "gpt-5.6-luna",
      schemaName: "popover_music_metadata",
      schema,
      reasoningEffort: "low",
      maxOutputTokens: 500,
      timeoutMs: 12000,
      system: `You normalize YouTube upload metadata into canonical music metadata for a lyrics search app.

The YouTube channel is the uploader, NOT necessarily the recording artist. Infer the artist primarily from the video title and use the channel only as supporting evidence.

Rules:
1. Return the canonical song title and primary artist(s) that should be used to search a Korean music service.
2. Remove upload noise such as Official Video, Official MV, Music Video, Audio, Lyrics, Lyric Video, Visualizer, 4K, HD, subtitles, reaction labels, label/channel branding, VEVO, and Topic suffixes.
3. Preserve information that changes the actual recording identity when material, such as Remix, Live, Acoustic, or a featured artist. Do not preserve decorative upload text.
4. Do not assume the channel name is the artist. A label, distributor, broadcaster, fan channel, or generic official channel may upload the song.
5. If the title follows an artist - song pattern, strongly prefer that evidence.
6. Never invent an artist or song unsupported by the supplied metadata. When uncertain, clean conservatively and lower confidence.
7. searchQuery should be a compact query in the form "artist title" with no upload noise.`,
      user: `YouTube title: ${rawTitle}\nYouTube channel: ${rawChannel || "Unknown"}`,
    });

    const title = result.data.title.trim() || rawTitle;
    const artist = result.data.artist.trim() || rawChannel || "Unknown artist";
    const searchQuery = result.data.searchQuery.trim() || `${artist} ${title}`.trim();
    const confidence = Number.isFinite(result.data.confidence)
      ? Math.max(0, Math.min(1, result.data.confidence))
      : 0;

    return NextResponse.json({ title, artist, searchQuery, confidence, model: result.model });
  } catch (error) {
    if (error instanceof OpenAIRequestError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "음악 메타데이터를 정제하지 못했습니다." }, { status: 502 });
  }
}
