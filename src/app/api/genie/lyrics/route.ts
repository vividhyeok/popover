import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { songId } = (await request.json()) as { songId?: string };
  if (!songId || !/^\d+$/.test(songId)) {
    return NextResponse.json({ error: "올바른 Genie 곡 ID가 아닙니다." }, { status: 400 });
  }

  try {
    const response = await fetch(`https://dn.genie.co.kr/app/purchase/get_msl.asp?path=a&songid=${songId}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("Genie lyric fetch failed");
    const raw = await response.text();
    const start = raw.indexOf("(");
    const end = raw.lastIndexOf(")");
    if (start < 0 || end <= start) throw new Error("Unexpected Genie response");
    const lyricMap = JSON.parse(raw.slice(start + 1, end)) as Record<string, string>;
    const entries = Object.entries(lyricMap).sort((a, b) => Number(a[0]) - Number(b[0]));
    const lrc = entries
      .map(([ms, lyric]) => {
        const value = Number(ms);
        const minutes = Math.floor(value / 60000);
        const seconds = Math.floor((value % 60000) / 1000);
        const hundredths = Math.floor((value % 1000) / 10);
        return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}] ${lyric}`;
      })
      .join("\n");
    return NextResponse.json({ lrc, lineCount: entries.length });
  } catch {
    return NextResponse.json({ error: "Genie 동기화 가사를 가져오지 못했습니다. 수동 LRC 입력을 이용해주세요." }, { status: 502 });
  }
}

