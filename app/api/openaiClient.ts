interface OpenAiConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

interface ResponsesRequest {
  model?: string;
  instructions: string;
  inputText: string;
}

interface ResponsesApiResponse {
  model?: string;
  created_at?: number;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      value?: string;
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

export async function callResponsesApi(
  request: ResponsesRequest
): Promise<{
  model: string;
  generatedAt: string;
  outputText: string;
  rawResponse: ResponsesApiResponse;
}> {
  const config = getOpenAiConfig();
  const response = await fetch(`${config.baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: request.model ?? config.model,
      instructions: request.instructions,
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
      ]
    })
  });

  const payload = (await response.json().catch(() => null)) as
    | ResponsesApiResponse
    | { error?: { message?: string } }
    | null;

  if (!response.ok) {
    const message =
      payload && "error" in payload
        ? payload.error?.message
        : "OpenAI Responses API request failed.";
    throw new Error(message || "OpenAI Responses API request failed.");
  }

  const outputText = extractOutputText(payload as ResponsesApiResponse);

  if (!outputText) {
    throw new Error("The Responses API returned no text output.");
  }

  const typedPayload = payload as ResponsesApiResponse;

  return {
    model: typedPayload.model || request.model || config.model,
    generatedAt: typedPayload.created_at
      ? new Date(typedPayload.created_at * 1000).toISOString()
      : new Date().toISOString(),
    outputText,
    rawResponse: typedPayload
  };
}
