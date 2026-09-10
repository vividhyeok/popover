import { DEFAULT_OPENAI_MODEL, resolveOpenAIModel, type OpenAIModel } from "./ai-config";

const OPENAI_API_KEY_STORAGE_KEY = "popover.openai.api-key.v1";
const OPENAI_MODEL_STORAGE_KEY = "popover.openai.model.v1";

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

export function loadOpenAIModel(): OpenAIModel {
  if (typeof window === "undefined") return DEFAULT_OPENAI_MODEL;
  return resolveOpenAIModel(window.localStorage.getItem(OPENAI_MODEL_STORAGE_KEY));
}

export function saveOpenAIModel(model: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(OPENAI_MODEL_STORAGE_KEY, resolveOpenAIModel(model));
}
