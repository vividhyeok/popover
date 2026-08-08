import type { Song } from "./types";

const now = Date.now();

export const demoSong: Song = {
  id: "popover-demo",
  title: "A Line at a Time",
  artist: "Popover Studio",
  thumbnail: "/popover-demo-cover.png",
  duration: 46,
  source: "demo",
  syncOffsetMs: 0,
  createdAt: now,
  lyrics: [
    [0, 5.5, "I left the window open for the morning", "아침을 맞으려고 창문을 열어 두었어"],
    [5.5, 10.5, "A quiet city slowly learned to glow", "고요한 도시는 천천히 빛나는 법을 배웠지"],
    [10.5, 16, "I wrote the words I couldn't say out loud", "나는 소리 내 말하지 못한 단어들을 적었어"],
    [16, 21.5, "Then let the rhythm carry what I know", "그리고 리듬이 내 마음을 데려가게 했어"],
    [21.5, 27.5, "One line, one breath, I listen once again", "한 문장, 한 호흡, 나는 다시 한번 들어"],
    [27.5, 33.5, "The missing sounds are clearer than before", "놓쳤던 소리가 전보다 선명해져"],
    [33.5, 39.5, "I don't need to understand it all tonight", "오늘 밤 전부 이해할 필요는 없어"],
    [39.5, 46, "I only need to hear one sentence more", "그저 한 문장만 더 들으면 돼"],
  ].map(([start, end, english, korean], index) => ({
    id: `demo-line-${index}`,
    start: start as number,
    end: end as number,
    english: english as string,
    korean: korean as string,
  })),
  progress: {
    position: 0,
    activeLine: 0,
    lineProgress: {},
    lastStudiedAt: now,
  },
};

