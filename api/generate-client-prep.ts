import { generateClientPrep } from "../app/api/generate-client-prep.js";

interface VercelLikeRequest {
  method?: string;
  body?: unknown;
}

interface VercelLikeResponse {
  setHeader(name: string, value: string): void;
  status(code: number): VercelLikeResponse;
  json(payload: unknown): void;
}

function normalizeBody(body: unknown): {
  company?: string;
  attendees?: string;
  meetingObjective?: string;
  notes?: string;
} {
  if (typeof body === "string") {
    return JSON.parse(body) as {
      company?: string;
      attendees?: string;
      meetingObjective?: string;
      notes?: string;
    };
  }

  if (body && typeof body === "object") {
    return body as {
      company?: string;
      attendees?: string;
      meetingObjective?: string;
      notes?: string;
    };
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

    if (!input.company?.trim() || !input.attendees?.trim()) {
      response.status(400).json({
        error: "Company and attendees are required."
      });
      return;
    }

    const result = await generateClientPrep({
      company: input.company,
      attendees: input.attendees,
      meetingObjective: input.meetingObjective,
      notes: input.notes
    });

    response.status(200).json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error.";
    response.status(500).json({ error: message });
  }
}
