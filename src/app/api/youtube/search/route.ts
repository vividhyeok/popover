import { NextResponse } from "next/server";

type YouTubeSearchItem = {
  id: { videoId: string };
  snippet: {
    title: string;
    channelTitle: string;
    thumbnails?: { medium?: { url?: string } };
  };
};

export async function POST(request: Request) {
  const { query } = (await request.json()) as { query?: string };
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "앱 안 검색에는 YOUTUBE_API_KEY가 필요합니다. URL이나 영상 ID는 키 없이 등록할 수 있어요." },
      { status: 503 },
    );
  }
  if (!query?.trim()) return NextResponse.json({ error: "검색어를 입력해주세요." }, { status: 400 });

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", "6");
  url.searchParams.set("q", query.trim());
  url.searchParams.set("key", apiKey);

  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const data = (await response.json()) as { items?: YouTubeSearchItem[]; error?: { message?: string } };
  if (!response.ok) {
    return NextResponse.json({ error: data?.error?.message ?? "YouTube 검색에 실패했습니다." }, { status: response.status });
  }

  return NextResponse.json({
    results: (data.items ?? []).map((item) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      artist: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails?.medium?.url,
    })),
  });
}
