import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateClientPrepPhase1,
  generateClientPrepPhase2
} from "./app/api/generate-client-prep.js";
import type { ResearchPacket } from "./app/api/buildResearchPacket.js";

const PORT = Number(process.env.PORT || 4173);
const distRoot = fileURLToPath(new URL("./", import.meta.url));

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function sendJson(
  response: import("node:http").ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

async function readRequestBody(
  request: import("node:http").IncomingMessage
): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf-8");
}

async function handlePhase1Request(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse
): Promise<void> {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  try {
    const rawBody = await readRequestBody(request);
    const input = JSON.parse(rawBody) as {
      company?: string;
      attendees?: string;
      meetingObjective?: string;
      notes?: string;
    };

    if (!input.company?.trim() || !input.attendees?.trim()) {
      sendJson(response, 400, {
        error: "Company and attendees are required."
      });
      return;
    }

    const result = await generateClientPrepPhase1({
      company: input.company,
      attendees: input.attendees,
      meetingObjective: input.meetingObjective,
      notes: input.notes
    });

    sendJson(response, 200, result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error.";
    sendJson(response, 500, { error: message });
  }
}

async function handlePhase2Request(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse
): Promise<void> {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  try {
    const rawBody = await readRequestBody(request);
    const input = JSON.parse(rawBody) as {
      researchPacket?: ResearchPacket;
      phase1Markdown?: string;
    };

    if (!input.researchPacket || !input.phase1Markdown?.trim()) {
      sendJson(response, 400, {
        error: "researchPacket and phase1Markdown are required."
      });
      return;
    }

    const result = await generateClientPrepPhase2(
      input.researchPacket,
      input.phase1Markdown
    );

    sendJson(response, 200, result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error.";
    sendJson(response, 500, { error: message });
  }
}

async function serveStaticFile(
  pathname: string,
  response: import("node:http").ServerResponse
): Promise<void> {
  const normalizedPath = pathname === "/" ? "/app/web/index.html" : pathname;
  const safePath = normalize(normalizedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(distRoot, safePath);

  try {
    const file = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type":
        contentTypes[extname(filePath)] || "application/octet-stream"
    });
    response.end(file);
  } catch {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8"
    });
    response.end("Not found");
  }
}

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);

  if (url.pathname === "/api/generate-client-prep") {
    await handlePhase1Request(request, response);
    return;
  }

  if (url.pathname === "/api/generate-client-prep-phase-2") {
    await handlePhase2Request(request, response);
    return;
  }

  await serveStaticFile(url.pathname, response);
}).listen(PORT, () => {
  console.log(`TPG Client Prep Assistant running at http://localhost:${PORT}`);
});
