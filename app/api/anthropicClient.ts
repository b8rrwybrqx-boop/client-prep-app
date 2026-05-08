interface AnthropicConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

interface AnthropicTextCitation {
  type?: string;
  url?: string;
  title?: string;
  cited_text?: string;
}

interface AnthropicContentBlock {
  type?: string;
  text?: string;
  citations?: AnthropicTextCitation[];
  content?: Array<{
    type?: string;
    url?: string;
    title?: string;
    encrypted_content?: string;
  }>;
}

interface AnthropicMessageResponse {
  model?: string;
  stop_reason?: string;
  content?: AnthropicContentBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export function getAnthropicConfig(): AnthropicConfig {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is missing. Add it to your .env file.");
  }

  return {
    apiKey,
    model: process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6",
    baseUrl:
      process.env.ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com/v1"
  };
}

function extractOutputText(payload: AnthropicMessageResponse): string {
  return (payload.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractCitations(
  payload: AnthropicMessageResponse
): Array<{ url: string; title?: string }> {
  const seen = new Set<string>();
  const citations: Array<{ url: string; title?: string }> = [];

  const fromTextBlocks =
    payload.content
      ?.filter((block) => block.type === "text")
      .flatMap((block) => block.citations ?? []) ?? [];

  for (const citation of fromTextBlocks) {
    if (!citation.url || seen.has(citation.url)) {
      continue;
    }

    seen.add(citation.url);
    citations.push({ url: citation.url, title: citation.title });
  }

  // Fallback: surface raw web_search_tool_result entries when the model returned
  // no inline citations (rare, but happens on terse outputs).
  const fromToolResults =
    payload.content
      ?.filter((block) => block.type === "web_search_tool_result")
      .flatMap((block) => block.content ?? [])
      .filter((item) => item.type === "web_search_result") ?? [];

  for (const item of fromToolResults) {
    if (!item.url || seen.has(item.url)) {
      continue;
    }

    seen.add(item.url);
    citations.push({ url: item.url, title: item.title });
  }

  return citations;
}

export async function searchWithAnthropicWeb(
  inputText: string
): Promise<{
  outputText: string;
  citations: Array<{ url: string; title?: string }>;
  model: string;
}> {
  const config = getAnthropicConfig();

  const response = await fetch(`${config.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 1024,
      system:
        "Use web search to find public information. Return concise factual output only. Prefer recent public indexed sources and preserve uncertainty when titles conflict.",
      tools: [
        {
          type: "web_search_20260209",
          name: "web_search",
          max_uses: 5
        }
      ],
      messages: [
        {
          role: "user",
          content: inputText
        }
      ]
    })
  });

  const payload = (await response.json().catch(() => null)) as
    | AnthropicMessageResponse
    | { error?: { message?: string } }
    | null;

  if (!response.ok) {
    const message =
      payload && "error" in payload
        ? payload.error?.message
        : "Anthropic web search request failed.";
    throw new Error(message || "Anthropic web search request failed.");
  }

  const typedPayload = payload as AnthropicMessageResponse;
  return {
    outputText: extractOutputText(typedPayload),
    citations: extractCitations(typedPayload),
    model: typedPayload.model ?? config.model
  };
}
