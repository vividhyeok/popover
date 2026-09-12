import { NextResponse } from "next/server";

function extractVideoId(input: string) {
  const trimmed = input.trim();
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname === "youtu.be") return url.pathname.split("/")[1]?.slice(0, 11);
    if (url.hostname.endsWith("youtube.com")) {
      if (url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/embed/")) {
        return url.pathname.split("/")[2]?.slice(0, 11);
      }
      return url.searchParams.get("v")?.slice(0, 11);
    }
  } catch {
    return null;
  }
  return null;
}

const uploadNoise = /\b(official\s*(music\s*)?(video|mv|audio)|music\s*video|lyric\s*video|lyrics?|official\s*visualizer|visualizer|audio|mv|m\/v|4k|uhd|hd)\b/i;

function cleanBracketNoise(value: string) {
  return value
    .replace(/\([^)]*\)/g, (match) => uploadNoise.test(match) ? " " : match)
    .replace(/\[[^\]]*\]/g, (match) => uploadNoise.test(match) ? " " : match)
    .replace(/【[^】]*】/g, (match) => uploadNoise.test(match) ? " " : match)
    .replace(/\s+/g, " ")
    .trim();
}

function cleanChannel(value: string) {
  return value
    .replace(/\s*-\s*Topic$/i, "")
    .replace(/\s+Official$/i, "")
    .replace(/VEVO$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeYouTubeMetadata(title: string, channel: string) {
  const cleanedTitle = cleanBracketNoise(title)
    .replace(/\s*[|｜]\s*(official\s*)?(music\s*)?(video|audio|lyrics?).*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const cleanedChannel = cleanChannel(channel);

  const separator = cleanedTitle.match(/^(.{1,100}?)\s+[-–—]\s+(.{1,180})$/);
  if (separator) {
    const artistCandidate = separator[1].trim();
    const titleCandidate = separator[2].trim();
    if (artistCandidate && titleCandidate && !uploadNoise.test(artistCandidate)) {
      return { title: titleCandidate, artist: artistCandidate };
    }
  }

  return {
    title: cleanedTitle || title,
    artist: cleanedChannel || channel,
  };
}

export async function POST(request: Request) {
  const { input } = (await request.json()) as { input?: string };
  const videoId = extractVideoId(input ?? "");
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return NextResponse.json({ error: "올바른 YouTube URL 또는 11자리 영상 ID를 입력해주세요." }, { status: 400 });
  }

  try {
    const endpoint = new URL("https://www.youtube.com/oembed");
    endpoint.searchParams.set("url", `https://www.youtube.com/watch?v=${videoId}`);
    endpoint.searchParams.set("format", "json");
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error("oEmbed lookup failed");
    const data = (await response.json()) as { title: string; author_name: string; thumbnail_url: string };
    const normalized = normalizeYouTubeMetadata(data.title, data.author_name);
    return NextResponse.json({
      videoId,
      title: normalized.title,
      artist: normalized.artist,
      originalTitle: data.title,
      originalChannel: data.author_name,
      thumbnail: data.thumbnail_url,
    });
  } catch {
    return NextResponse.json({
      videoId,
      title: "YouTube video",
      artist: "Unknown artist",
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    });
  }
}
