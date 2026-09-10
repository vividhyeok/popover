const OPENAI_API_KEY_STORAGE_KEY = "popover.openai.api-key.v1";

export function loadOpenAIApiKey() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(OPENAI_API_KEY_STORAGE_KEY)?.trim() ?? "";
}

export function saveOpenAIApiKey(apiKey: string) {
  if (typeof window === "undefined") return;
  const value = apiKey.trim();
  if (value) window.localStorage.setItem(OPENAI_API_KEY_STORAGE_KEY, value);
  else window.localStorage.removeItem(OPENAI_API_KEY_STORAGE_KEY);
}
