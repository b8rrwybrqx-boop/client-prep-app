import { searchWithOpenAiWeb } from "../app/api/openaiClient.js";
import { searchWithAnthropicWeb } from "../app/api/anthropicClient.js";

interface PromptVariant {
  label: string;
  build: (name: string, company: string, title?: string) => string;
}

// These prompts are copied verbatim from tools/attendeeResearch.ts so the
// comparison reflects exactly what the live code asks each provider.
const VARIANTS: PromptVariant[] = [
  {
    label: "generic",
    build: (name, company) =>
      [
        `Find public indexed information for attendee "${name}" at company "${company}".`,
        "Return up to two likely traces with current or recent title/function if available.",
        "If titles conflict, include both and say current title is unconfirmed.",
        "Focus on marketing, brand, innovation, sales, commercial, finance, operations, or leadership clues.",
        "Format:",
        "1. [source summary]",
        "2. [source summary]"
      ].join("\n")
  },
  {
    label: "broaden",
    build: (name, company) =>
      [
        `Find any public indexed reference connecting "${name}" with "${company}", its parent or subsidiaries, or any of its known brands.`,
        "Be thorough. Consider: LinkedIn profiles (current or past), press releases, conference speaker lists, podcast appearances, trade publications, brand-specific announcements, patent or regulatory filings, and quoted commentary.",
        "Allow for nickname / full-name pairs (Mike↔Michael, Bill↔William, Jimmy↔James, Liz↔Elizabeth), alternate spellings, and alternate publishing names.",
        "If multiple plausible candidates exist, return up to two with brief reasoning about how each connects to the company.",
        "Only declare 'no match' after considering brand-team and subsidiary roles, not just corporate-level positions.",
        "Format:",
        "1. [signal summary]",
        "2. [signal summary]"
      ].join("\n")
  },
  {
    label: "title-aware",
    build: (name, company, title) =>
      [
        `Find recent public information about "${name}", ${title ?? "[TITLE]"} at "${company}".`,
        "Prefer the last 24 months: quotes in articles, conference talks, podcast appearances, press releases, notable initiatives, or strategic priorities they have spoken to.",
        "Return up to two concise bullets summarizing distinct signals.",
        "Format:",
        "1. [signal summary]",
        "2. [signal summary]"
      ].join("\n")
  }
];

interface ProviderResult {
  outputText: string;
  citations: Array<{ url: string; title?: string }>;
  latencyMs: number;
  error?: string;
  model?: string;
}

async function timed<T extends { outputText: string; citations: Array<{ url: string; title?: string }>; model?: string }>(
  call: () => Promise<T>
): Promise<ProviderResult> {
  const start = Date.now();
  try {
    const result = await call();
    return {
      outputText: result.outputText,
      citations: result.citations,
      latencyMs: Date.now() - start,
      model: result.model
    };
  } catch (error) {
    return {
      outputText: "",
      citations: [],
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function indent(text: string, prefix = "    "): string {
  if (!text) {
    return `${prefix}(empty)`;
  }

  return text
    .split(/\r?\n/)
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function formatCitations(
  citations: Array<{ url: string; title?: string }>
): string {
  if (citations.length === 0) {
    return "    (no citations)";
  }

  return citations
    .slice(0, 5)
    .map((c, i) => `    ${i + 1}. ${c.title ? `${c.title} — ` : ""}${c.url}`)
    .join("\n");
}

function printProviderBlock(name: string, result: ProviderResult): void {
  const header =
    `  [${name}]` +
    (result.model ? ` model=${result.model}` : "") +
    ` latency=${result.latencyMs}ms` +
    (result.error ? ` ERROR` : "");
  console.log(header);

  if (result.error) {
    console.log(indent(result.error));
    return;
  }

  console.log("  output:");
  console.log(indent(result.outputText));
  console.log("  citations:");
  console.log(formatCitations(result.citations));
}

async function runVariant(
  variant: PromptVariant,
  name: string,
  company: string,
  title: string | undefined
): Promise<void> {
  if (variant.label === "title-aware" && !title) {
    console.log(`\n=== variant: ${variant.label} ===`);
    console.log("  (skipped — pass a --title to run the title-aware variant)");
    return;
  }

  const prompt = variant.build(name, company, title);
  console.log(`\n=== variant: ${variant.label} ===`);
  console.log(indent(prompt, "  > "));

  const [openai, anthropic] = await Promise.all([
    timed(() => searchWithOpenAiWeb(prompt).then((r) => ({ ...r, model: undefined }))),
    timed(() => searchWithAnthropicWeb(prompt))
  ]);

  printProviderBlock("OpenAI", openai);
  printProviderBlock("Anthropic", anthropic);
}

interface CliArgs {
  name: string;
  company: string;
  title?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--name" && next) {
      args.name = next;
      i++;
    } else if (arg === "--company" && next) {
      args.company = next;
      i++;
    } else if (arg === "--title" && next) {
      args.title = next;
      i++;
    }
  }

  if (!args.name || !args.company) {
    console.error(
      'Usage: node dist/scripts/compareAttendeeSearch.js --name "Jane Smith" --company "Bridges Consumer Healthcare" [--title "VP Marketing"]'
    );
    process.exit(1);
  }

  return args as CliArgs;
}

async function main(): Promise<void> {
  const { name, company, title } = parseArgs(process.argv.slice(2));

  console.log(`Comparing attendee search for: ${name} @ ${company}`);
  if (title) {
    console.log(`Title hint: ${title}`);
  }

  for (const variant of VARIANTS) {
    await runVariant(variant, name, company, title);
  }

  console.log("\nDone.");
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
