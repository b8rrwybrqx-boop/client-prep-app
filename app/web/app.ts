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

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const payload = {
    company: String(formData.get("company") ?? ""),
    attendees: String(formData.get("attendees") ?? ""),
    meetingObjective: String(formData.get("meetingObjective") ?? ""),
    notes: String(formData.get("notes") ?? "")
  };

  setStatus("Generating client prep brief...");
  generateButton.disabled = true;
  debugPanel.hidden = true;
  renderOutputPlaceholder("Generating client prep brief...");

  try {
    const response = await fetch("/api/generate-client-prep", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorPayload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      throw new Error(errorPayload?.error ?? "Request failed.");
    }

    const result = (await response.json()) as {
      markdown: string;
      rawModelText: string;
      researchPacket: {
        companyFacts: unknown;
        attendeeFacts: unknown;
        mna: unknown;
        latestDevelopments?: unknown;
      };
      qualityReport: unknown;
      meta: { model: string; generatedAt: string };
    };

    outputElement.innerHTML = `
      <div class="brief-meta-row">
        <p class="brief-meta">
          ${escapeHtml(result.meta.model)} •
          ${escapeHtml(new Date(result.meta.generatedAt).toLocaleString())}
        </p>
      </div>
      <section class="brief-section markdown-output">
        ${renderMarkdown(result.markdown)}
      </section>
    `;

    debugMeta.textContent = JSON.stringify(result.meta, null, 2);
    debugQuality.textContent = JSON.stringify(result.qualityReport, null, 2);
    debugPacket.textContent = JSON.stringify(
      {
        companyFacts: result.researchPacket.companyFacts,
        attendeeFacts: result.researchPacket.attendeeFacts,
        mna: result.researchPacket.mna,
        latestDevelopments: result.researchPacket.latestDevelopments ?? []
      },
      null,
      2
    );
    debugRaw.textContent = result.rawModelText;
    debugPanel.hidden = false;
    outputElement.hidden = false;
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
