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
    return NextResponse.json({
      videoId,
      title: data.title,
      artist: data.author_name,
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

