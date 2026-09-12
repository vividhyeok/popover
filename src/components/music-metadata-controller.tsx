"use client";

import { useEffect } from "react";

import { loadOpenAIApiKey } from "@/lib/openai-key";

type ResolvedYouTube = {
  videoId?: string;
  title?: string;
  artist?: string;
  thumbnail?: string;
  originalTitle?: string;
  originalChannel?: string;
  [key: string]: unknown;
};

type RefinedMetadata = {
  title?: string;
  artist?: string;
  searchQuery?: string;
  confidence?: number;
};

function requestPath(input: RequestInfo | URL) {
  try {
    const value = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    return new URL(value, window.location.origin).pathname;
  } catch {
    return "";
  }
}

function jsonResponse(source: Response, data: Record<string, unknown>) {
  const headers = new Headers(source.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  return new Response(JSON.stringify(data), {
    status: source.status,
    statusText: source.statusText,
    headers,
  });
}

export function MusicMetadataController() {
  useEffect(() => {
    const originalFetch = window.fetch;

    const enhancedFetch: typeof window.fetch = async (input, init) => {
      if (requestPath(input) !== "/api/youtube/resolve") {
        return originalFetch.call(window, input, init);
      }

      const response = await originalFetch.call(window, input, init);
      if (!response.ok) return response;

      let resolved: ResolvedYouTube;
      try {
        resolved = await response.clone().json() as ResolvedYouTube;
      } catch {
        return response;
      }

      const rawTitle = String(resolved.originalTitle ?? resolved.title ?? "").trim();
      const rawChannel = String(resolved.originalChannel ?? resolved.artist ?? "").trim();
      if (!rawTitle || rawTitle === "YouTube video") return response;

      try {
        const metadataResponse = await originalFetch.call(window, "/api/music/metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: rawTitle,
            channel: rawChannel,
            apiKey: loadOpenAIApiKey(),
          }),
        });
        if (!metadataResponse.ok) return response;

        const metadata = await metadataResponse.json() as RefinedMetadata;
        const title = metadata.title?.trim();
        const artist = metadata.artist?.trim();
        if (!title || !artist) return response;

        return jsonResponse(response, {
          ...resolved,
          title,
          artist,
          searchQuery: metadata.searchQuery?.trim() || `${artist} ${title}`,
          metadataConfidence: metadata.confidence ?? 0,
          metadataSource: "openai-luna",
          originalTitle: rawTitle,
          originalChannel: rawChannel,
        });
      } catch {
        // Metadata refinement is an enhancement. Keep the deterministic YouTube
        // result when OpenAI is unavailable, slow, or misconfigured.
        return response;
      }
    };

    window.fetch = enhancedFetch;
    return () => {
      if (window.fetch === enhancedFetch) window.fetch = originalFetch;
    };
  }, []);

  return null;
}
