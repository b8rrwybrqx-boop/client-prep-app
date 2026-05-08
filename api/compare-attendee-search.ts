import { compareAttendeeSearch } from "../app/api/compareAttendeeSearch.js";

interface VercelLikeRequest {
  method?: string;
  url?: string;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
}

interface VercelLikeResponse {
  setHeader(name: string, value: string): void;
  status(code: number): VercelLikeResponse;
  json(payload: unknown): void;
  send(payload: string): void;
}

interface ParsedInput {
  name: string;
  company: string;
  title?: string;
  format: "json" | "text";
}

function firstString(
  value: string | string[] | undefined
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function parseQueryFromUrl(url?: string): URLSearchParams {
  if (!url) {
    return new URLSearchParams();
  }

  const queryStart = url.indexOf("?");
  if (queryStart < 0) {
    return new URLSearchParams();
  }

  return new URLSearchParams(url.slice(queryStart + 1));
}

function parseInput(request: VercelLikeRequest): ParsedInput | null {
  const fields: Record<string, string | undefined> = {};

  if (request.method === "POST") {
    const body =
      typeof request.body === "string"
        ? (JSON.parse(request.body) as Record<string, unknown>)
        : ((request.body ?? {}) as Record<string, unknown>);

    fields.name =
      typeof body.name === "string" ? body.name : undefined;
    fields.company =
      typeof body.company === "string" ? body.company : undefined;
    fields.title =
      typeof body.title === "string" ? body.title : undefined;
    fields.format =
      typeof body.format === "string" ? body.format : undefined;
  } else {
    const query = request.query ?? {};
    const fallback = parseQueryFromUrl(request.url);

    fields.name = firstString(query.name) ?? fallback.get("name") ?? undefined;
    fields.company =
      firstString(query.company) ?? fallback.get("company") ?? undefined;
    fields.title =
      firstString(query.title) ?? fallback.get("title") ?? undefined;
    fields.format =
      firstString(query.format) ?? fallback.get("format") ?? undefined;
  }

  if (!fields.name?.trim() || !fields.company?.trim()) {
    return null;
  }

  return {
    name: fields.name.trim(),
    company: fields.company.trim(),
    title: fields.title?.trim() || undefined,
    format: fields.format === "text" ? "text" : "json"
  };
}

function renderText(
  result: Awaited<ReturnType<typeof compareAttendeeSearch>>
): string {
  const lines: string[] = [];
  lines.push(`Comparing attendee search for: ${result.name} @ ${result.company}`);
  if (result.title) {
    lines.push(`Title hint: ${result.title}`);
  }

  for (const variant of result.variants) {
    lines.push("");
    lines.push(`=== variant: ${variant.variant} ===`);
    if (variant.skipped) {
      lines.push(`  (skipped — ${variant.skipped})`);
      continue;
    }

    lines.push("");
    lines.push("PROMPT:");
    lines.push(variant.prompt);

    for (const [label, run] of [
      ["OpenAI", variant.openai],
      ["Anthropic", variant.anthropic]
    ] as const) {
      if (!run) continue;
      lines.push("");
      lines.push(
        `[${label}] model=${run.model ?? "(unspecified)"} latency=${run.latencyMs}ms${run.error ? " ERROR" : ""}`
      );
      if (run.error) {
        lines.push(run.error);
        continue;
      }
      lines.push("output:");
      lines.push(run.outputText || "(empty)");
      lines.push("citations:");
      if (run.citations.length === 0) {
        lines.push("  (none)");
      } else {
        for (const [i, c] of run.citations.slice(0, 5).entries()) {
          lines.push(`  ${i + 1}. ${c.title ? `${c.title} — ` : ""}${c.url}`);
        }
      }
    }
  }

  return lines.join("\n");
}

export default async function handler(
  request: VercelLikeRequest,
  response: VercelLikeResponse
): Promise<void> {
  if (request.method !== "GET" && request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const input = parseInput(request);
  if (!input) {
    response.status(400).json({
      error:
        'name and company are required. Example: GET /api/compare-attendee-search?name=Jane%20Smith&company=Bridges%20Consumer%20Healthcare&format=text'
    });
    return;
  }

  try {
    const result = await compareAttendeeSearch(
      input.name,
      input.company,
      input.title
    );

    if (input.format === "text") {
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.status(200).send(renderText(result));
      return;
    }

    response.status(200).json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error.";
    response.status(500).json({ error: message });
  }
}
