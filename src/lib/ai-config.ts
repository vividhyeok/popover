export const OPENAI_MODEL_OPTIONS = [
  { value: "gpt-6-astra", label: "GPT-6 Astra", description: "최고 품질 · 기본" },
  { value: "gpt-5.6-sol", label: "GPT-5.6 Sol", description: "고품질 · 비용 절감" },
  { value: "gpt-5.6-terra", label: "GPT-5.6 Terra", description: "균형형" },
  { value: "gpt-5.6-luna", label: "GPT-5.6 Luna", description: "저비용" },
] as const;

export type OpenAIModel = (typeof OPENAI_MODEL_OPTIONS)[number]["value"];

export const DEFAULT_OPENAI_MODEL: OpenAIModel = "gpt-6-astra";

const OPENAI_MODEL_SET = new Set<string>(OPENAI_MODEL_OPTIONS.map((item) => item.value));

export function resolveOpenAIModel(value?: string | null): OpenAIModel {
  return value && OPENAI_MODEL_SET.has(value) ? value as OpenAIModel : DEFAULT_OPENAI_MODEL;
}
