import {
  generateClientPrepPhase2,
  type ClientPrepPhase2Result
} from "../app/api/generate-client-prep.js";
import type { ResearchPacket } from "../app/api/buildResearchPacket.js";

interface VercelLikeRequest {
  method?: string;
  body?: unknown;
}

interface VercelLikeResponse {
  setHeader(name: string, value: string): void;
  status(code: number): VercelLikeResponse;
  json(payload: unknown): void;
}

interface Phase2RequestBody {
  researchPacket?: ResearchPacket;
  phase1Markdown?: string;
}

function normalizeBody(body: unknown): Phase2RequestBody {
  if (typeof body === "string") {
    return JSON.parse(body) as Phase2RequestBody;
  }

  if (body && typeof body === "object") {
    return body as Phase2RequestBody;
  }

  return {};
}

export default async function handler(
  request: VercelLikeRequest,
  response: VercelLikeResponse
): Promise<void> {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const input = normalizeBody(request.body);

    if (!input.researchPacket || !input.phase1Markdown?.trim()) {
      response.status(400).json({
        error: "researchPacket and phase1Markdown are required."
      });
      return;
    }

    const result: ClientPrepPhase2Result = await generateClientPrepPhase2(
      input.researchPacket,
      input.phase1Markdown
    );

    response.status(200).json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error.";
    response.status(500).json({ error: message });
  }
}
