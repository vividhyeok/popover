import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ListenUXController } from "@/components/listen-ux-controller";
import { MusicMetadataController } from "@/components/music-metadata-controller";
import { OpenAISettingsController } from "@/components/openai-settings-controller";
import { RevealPreferencesController } from "@/components/reveal-preferences-controller";
import "./globals.css";
import "./learning-enhancements.css";
import "./readability-fixes.css";
import "./simple-popover.css";
import "./media-shell.css";
import "./reveal-preferences.css";
import "./dictation-cloze-fix.css";
import "./openai-settings.css";
import "./listen-ux.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Popover — 팝송 문장 학습",
  description: "YouTube 영상과 문장별 가사로 듣기와 받아쓰기를 연습하는 PC 학습 도구",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <RevealPreferencesController />
        <OpenAISettingsController />
        <MusicMetadataController />
        <ListenUXController />
      </body>
    </html>
  );
}
