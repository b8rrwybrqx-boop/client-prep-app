interface OpenAiConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

interface ResponsesRequest {
  model?: string;
  instructions: string;
  inputText: string;
  tools?: Array<{ type: string }>;
}

interface ResponsesApiResponse {
  model?: string;
  created_at?: number;
  status?: string;
  incomplete_details?: {
    reason?: string;
  };
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      value?: string;
      annotations?: Array<{
        type?: string;
        url?: string;
        title?: string;
      }>;
    }>;
  }>;
  output_text?: string;
}

export function getOpenAiConfig(): OpenAiConfig {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing. Add it to your .env file.");
  }

  return {
    apiKey,
    model: process.env.OPENAI_MODEL?.trim() || "gpt-5",
    baseUrl:
      process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1"
  };
}

function extractOutputText(response: ResponsesApiResponse): string {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const textParts =
    response.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text ?? content.value ?? "")
      .filter(Boolean) ?? [];

  return textParts.join("\n").trim();
}

function extractCitations(response: ResponsesApiResponse): Array<{
  url: string;
  title?: string;
}> {
  const annotations =
    response.output
      ?.flatMap((item) => item.content ?? [])
      .flatMap((content) => content.annotations ?? [])
      .filter((annotation) => annotation.url) ?? [];

  const seen = new Set<string>();

  return annotations
    .map((annotation) => ({
      url: annotation.url as string,
      title: annotation.title
    }))
    .filter((annotation) => {
      if (seen.has(annotation.url)) {
        return false;
      }

      seen.add(annotation.url);
      return true;
    });
}

async function createResponsesRequest(
  config: OpenAiConfig,
  request: ResponsesRequest,
  options: {
    maxOutputTokens: number;
    reasoningEffort: "low" | "medium";
    verbosity: "low" | "medium";
  }
): Promise<Response> {
  const model = request.model ?? config.model;

  return fetch(`${config.baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model,
      instructions: request.instructions,
      max_output_tokens: options.maxOutputTokens,
      reasoning: model.startsWith("gpt-5")
        ? { effort: options.reasoningEffort }
        : undefined,
      text: {
        format: {
          type: "text"
        },
        verbosity: options.verbosity
      },
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: request.inputText
            }
          ]
        }
      ],
      tools: request.tools
    })
  });
}

export async function callResponsesApi(
  request: ResponsesRequest
): Promise<{
  model: string;
  generatedAt: string;
  outputText: string;
  rawResponse: ResponsesApiResponse;
}> {
  const config = getOpenAiConfig();
  const isVercel = process.env.VERCEL === "1";
  const firstResponse = await createResponsesRequest(config, request, {
    maxOutputTokens: isVercel ? 1400 : 1800,
    reasoningEffort: "low",
    verbosity: isVercel ? "low" : "medium"
  });

  let payload = (await firstResponse.json().catch(() => null)) as
    | ResponsesApiResponse
    | { error?: { message?: string } }
    | null;

  if (!firstResponse.ok) {
    const message =
      payload && "error" in payload
        ? payload.error?.message
        : "OpenAI Responses API request failed.";
    throw new Error(message || "OpenAI Responses API request failed.");
  }

  let typedPayload = payload as ResponsesApiResponse;
  let outputText = extractOutputText(typedPayload);

  if (
    !outputText &&
    typedPayload.status === "incomplete" &&
    typedPayload.incomplete_details?.reason === "max_output_tokens"
  ) {
    const retryResponse = await createResponsesRequest(config, request, {
      maxOutputTokens: isVercel ? 2400 : 2800,
      reasoningEffort: "low",
      verbosity: "low"
    });

    payload = (await retryResponse.json().catch(() => null)) as
      | ResponsesApiResponse
      | { error?: { message?: string } }
      | null;

    if (!retryResponse.ok) {
      const message =
        payload && "error" in payload
          ? payload.error?.message
          : "OpenAI Responses API request failed.";
      throw new Error(message || "OpenAI Responses API request failed.");
    }

    typedPayload = payload as ResponsesApiResponse;
    outputText = extractOutputText(typedPayload);
  }

  if (!outputText) {
    throw new Error("The Responses API returned no text output.");
  }

  return {
    model: typedPayload.model || request.model || config.model,
    generatedAt: typedPayload.created_at
      ? new Date(typedPayload.created_at * 1000).toISOString()
      : new Date().toISOString(),
    outputText,
    rawResponse: typedPayload
  };
}

export async function searchWithOpenAiWeb(
  inputText: string
): Promise<{
  outputText: string;
  citations: Array<{ url: string; title?: string }>;
}> {
  const config = getOpenAiConfig();
  const model =
    process.env.OPENAI_SEARCH_MODEL?.trim() ||
    (config.model.startsWith("gpt-5") ? "gpt-5-mini" : config.model);
  const response = await createResponsesRequest(
    config,
    {
      model,
      instructions:
        "Use web search to find public information. Return concise factual output only. Prefer recent public indexed sources and preserve uncertainty when titles conflict.",
      inputText,
      tools: [{ type: "web_search" }]
    },
    {
      maxOutputTokens: 500,
      reasoningEffort: "low",
      verbosity: "low"
    }
  );

  const payload = (await response.json().catch(() => null)) as
    | ResponsesApiResponse
    | { error?: { message?: string } }
    | null;

  if (!response.ok) {
    const message =
      payload && "error" in payload
        ? payload.error?.message
        : "OpenAI web search request failed.";
    throw new Error(message || "OpenAI web search request failed.");
  }

  const typedPayload = payload as ResponsesApiResponse;
  return {
    outputText: extractOutputText(typedPayload),
    citations: extractCitations(typedPayload)
  };
}
