import { NextResponse } from "next/server";

const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" };

type GenieSearchSong = { id?: string | number; word?: string; field1?: string };

export async function POST(request: Request) {
  const { query } = (await request.json()) as { query?: string };
  if (!query?.trim()) return NextResponse.json({ error: "곡명이나 아티스트를 입력해주세요." }, { status: 400 });

  try {
    const url = new URL("https://www.genie.co.kr/search/searchAuto");
    url.searchParams.set("query", query.trim());
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("Genie search failed");
    const data = (await response.json()) as { song?: GenieSearchSong[] };
    const results = (data.song ?? []).slice(0, 6).map((song) => ({
      id: String(song.id ?? ""),
      title: String(song.word ?? ""),
      artist: String(song.field1 ?? "").split(" - ")[0].trim(),
    }));
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "Genie 검색 응답을 불러오지 못했습니다. 잠시 뒤 다시 시도해주세요." }, { status: 502 });
  }
}
