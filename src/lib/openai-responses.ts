import { resolveOpenAIModel, type OpenAIModel } from "./ai-config";

export type OpenAIReasoningEffort = "low" | "medium" | "high";

type ResponsesApiContent = {
  type?: string;
  text?: string;
  refusal?: string;
};

type ResponsesApiResponse = {
  output?: Array<{ type?: string; content?: ResponsesApiContent[] }>;
  error?: { message?: string };
  status?: string;
  incomplete_details?: { reason?: string };
};

export class OpenAIRequestError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 502, code = "OPENAI_ERROR") {
    super(message);
    this.name = "OpenAIRequestError";
    this.status = status;
    this.code = code;
  }
}

export function resolveOpenAIApiKey(provided?: string | null) {
  return provided?.trim() || process.env.OPENAI_API_KEY?.trim() || "";
}

function extractOutputText(data: ResponsesApiResponse) {
  for (const item of data.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
      if (content.type === "refusal" && content.refusal) throw new OpenAIRequestError(content.refusal, 400, "MODEL_REFUSAL");
    }
  }
  return "";
}

export async function requestStructuredOpenAI<T>({
  apiKey,
  model,
  schemaName,
  schema,
  system,
  user,
  reasoningEffort = "low",
  maxOutputTokens = 4096,
  timeoutMs = 50000,
}: {
  apiKey: string;
  model?: string | OpenAIModel | null;
  schemaName: string;
  schema: Record<string, unknown>;
  system: string;
  user: string;
  reasoningEffort?: OpenAIReasoningEffort;
  maxOutputTokens?: number;
  timeoutMs?: number;
}) {
  const resolvedModel = resolveOpenAIModel(model);
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: resolvedModel,
        reasoning: { effort: reasoningEffort },
        max_output_tokens: maxOutputTokens,
        store: false,
        input: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        text: {
          format: {
            type: "json_schema",
            name: schemaName,
            strict: true,
            schema,
          },
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new OpenAIRequestError("OpenAI 응답 시간이 초과됐습니다. 다시 시도해주세요.", 504, "UPSTREAM_TIMEOUT");
    }
    throw new OpenAIRequestError("OpenAI API에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.", 502, "UPSTREAM_CONNECTION");
  }

  let data: ResponsesApiResponse;
  try {
    data = (await response.json()) as ResponsesApiResponse;
  } catch {
    throw new OpenAIRequestError("OpenAI가 읽을 수 없는 응답을 반환했습니다.", 502, "INVALID_UPSTREAM_RESPONSE");
  }

  if (!response.ok) {
    throw new OpenAIRequestError(data.error?.message ?? "OpenAI 요청에 실패했습니다.", response.status, "OPENAI_API_ERROR");
  }
  if (data.status === "incomplete") {
    throw new OpenAIRequestError(
      data.incomplete_details?.reason === "max_output_tokens"
        ? "OpenAI 응답이 출력 한도에 도달했습니다. 더 작은 구간으로 다시 시도해주세요."
        : "OpenAI 응답이 완료되지 않았습니다. 다시 시도해주세요.",
      502,
      "INCOMPLETE_RESPONSE",
    );
  }

  const text = extractOutputText(data);
  if (!text) throw new OpenAIRequestError("OpenAI가 빈 응답을 반환했습니다.", 502, "EMPTY_RESPONSE");

  try {
    return { data: JSON.parse(text) as T, model: resolvedModel };
  } catch {
    throw new OpenAIRequestError("OpenAI 구조화 응답을 해석하지 못했습니다.", 502, "INVALID_STRUCTURED_OUTPUT");
  }
}
