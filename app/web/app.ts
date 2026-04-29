const form = document.querySelector<HTMLFormElement>("#client-prep-form");
const statusElement = document.querySelector<HTMLParagraphElement>("#status");
const outputElement = document.querySelector<HTMLDivElement>("#output");
const generateButton =
  document.querySelector<HTMLButtonElement>("#generate-button");
const debugPanel = document.querySelector<HTMLDetailsElement>("#debug-panel");
const debugMeta = document.querySelector<HTMLPreElement>("#debug-meta");
const debugQuality = document.querySelector<HTMLPreElement>("#debug-quality");
const debugPacket = document.querySelector<HTMLPreElement>("#debug-packet");
const debugRaw = document.querySelector<HTMLPreElement>("#debug-raw");

if (
  !form ||
  !statusElement ||
  !outputElement ||
  !generateButton ||
  !debugPanel ||
  !debugMeta ||
  !debugQuality ||
  !debugPacket ||
  !debugRaw
) {
  throw new Error("Client prep app failed to initialize.");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderInline(value: string): string {
  return escapeHtml(value)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*\*/g, "")
    .replace(/\*(?=[A-Za-z])/g, "")
    .replace(/(?<=[A-Za-z:])\*/g, "");
}

function renderMarkdown(markdown: string): string {
  const lines = markdown.trim().split(/\r?\n/);
  const html: string[] = [];
  let listItems: string[] = [];

  function flushList(): void {
    if (listItems.length === 0) {
      return;
    }

    html.push(`<ul>${listItems.join("")}</ul>`);
    listItems = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushList();
      continue;
    }

    if (line.startsWith("### ")) {
      flushList();
      html.push(`<h3>${renderInline(line.slice(4))}</h3>`);
      continue;
    }

    if (line.startsWith("## ")) {
      flushList();
      html.push(`<h2>${renderInline(line.slice(3))}</h2>`);
      continue;
    }

    if (line.startsWith("# ")) {
      flushList();
      html.push(`<h1>${renderInline(line.slice(2))}</h1>`);
      continue;
    }

    if (line.startsWith("- ")) {
      listItems.push(`<li>${renderInline(line.slice(2))}</li>`);
      continue;
    }

    flushList();
    html.push(`<p>${renderInline(line)}</p>`);
  }

  flushList();

  return html.join("");
}

function setStatus(message: string, mode: "default" | "error" = "default"): void {
  statusElement!.textContent = message;
  statusElement!.dataset.state = mode;
}

function renderOutputPlaceholder(message: string): void {
  outputElement!.innerHTML = `
    <section class="brief-section empty-output">
      <p>${escapeHtml(message)}</p>
    </section>
  `;
  outputElement!.hidden = false;
}

interface Phase1Result {
  phase1Markdown: string;
  rawModelText: string;
  researchPacket: {
    companyFacts: unknown;
    attendeeFacts: unknown;
    mna: unknown;
    latestDevelopments?: unknown;
    [key: string]: unknown;
  };
  qualityReport: unknown;
  meta: { model: string; generatedAt: string };
}

interface Phase2Result {
  phase2Markdown: string;
  rawModelText: string;
  sources: string[];
  qualityReport: unknown;
  meta: { model: string; generatedAt: string };
}

function renderSourcesMarkdown(sources: string[]): string {
  if (sources.length === 0) {
    return "";
  }

  const sourceLines = sources.map((url, index) => {
    let label = "source";

    try {
      label = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      label = "source";
    }

    return `- [${label} ${index + 1}](${url})`;
  });

  return `## Sources\n${sourceLines.join("\n")}`;
}

function renderBriefSections(
  meta: { model: string; generatedAt: string },
  markdown: string,
  phase2Pending: boolean
): void {
  outputElement!.innerHTML = `
    <div class="brief-meta-row">
      <p class="brief-meta">
        ${escapeHtml(meta.model)} •
        ${escapeHtml(new Date(meta.generatedAt).toLocaleString())}
      </p>
    </div>
    <section class="brief-section markdown-output">
      ${renderMarkdown(markdown)}
    </section>
    ${
      phase2Pending
        ? '<section class="brief-section phase2-pending"><p><em>Generating TPG context, opportunities, and questions…</em></p></section>'
        : ""
    }
  `;
  outputElement!.hidden = false;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const payload = {
    company: String(formData.get("company") ?? ""),
    attendees: String(formData.get("attendees") ?? ""),
    meetingObjective: String(formData.get("meetingObjective") ?? ""),
    notes: String(formData.get("notes") ?? "")
  };

  setStatus("Generating company, competitive, and stakeholder context...");
  generateButton.disabled = true;
  debugPanel.hidden = true;
  renderOutputPlaceholder(
    "Generating company, competitive, and stakeholder context..."
  );

  try {
    const phase1Response = await fetch("/api/generate-client-prep", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!phase1Response.ok) {
      const errorPayload = (await phase1Response.json().catch(() => null)) as
        | { error?: string }
        | null;

      throw new Error(errorPayload?.error ?? "Request failed.");
    }

    const phase1 = (await phase1Response.json()) as Phase1Result;

    renderBriefSections(phase1.meta, phase1.phase1Markdown, true);
    setStatus("Phase 1 ready. Generating TPG context, opportunities, and questions...");

    const phase2Response = await fetch("/api/generate-client-prep-phase-2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        researchPacket: phase1.researchPacket,
        phase1Markdown: phase1.phase1Markdown
      })
    });

    if (!phase2Response.ok) {
      const errorPayload = (await phase2Response.json().catch(() => null)) as
        | { error?: string }
        | null;

      throw new Error(errorPayload?.error ?? "Phase 2 request failed.");
    }

    const phase2 = (await phase2Response.json()) as Phase2Result;
    const sourcesMarkdown = renderSourcesMarkdown(phase2.sources);
    const combined = [phase1.phase1Markdown, phase2.phase2Markdown, sourcesMarkdown]
      .filter(Boolean)
      .join("\n\n");

    renderBriefSections(phase2.meta, combined, false);

    debugMeta.textContent = JSON.stringify(
      { phase1: phase1.meta, phase2: phase2.meta },
      null,
      2
    );
    debugQuality.textContent = JSON.stringify(
      { phase1: phase1.qualityReport, phase2: phase2.qualityReport },
      null,
      2
    );
    debugPacket.textContent = JSON.stringify(
      {
        companyFacts: phase1.researchPacket.companyFacts,
        attendeeFacts: phase1.researchPacket.attendeeFacts,
        mna: phase1.researchPacket.mna,
        latestDevelopments: phase1.researchPacket.latestDevelopments ?? []
      },
      null,
      2
    );
    debugRaw.textContent = `${phase1.rawModelText}\n\n---\n\n${phase2.rawModelText}`;
    debugPanel.hidden = false;
    setStatus("Prep brief generated.");
  } catch (error) {
    console.error(error);
    renderOutputPlaceholder(
      error instanceof Error ? error.message : "Something went wrong."
    );
    setStatus(
      error instanceof Error ? error.message : "Something went wrong.",
      "error"
    );
  } finally {
    generateButton.disabled = false;
  }
});
