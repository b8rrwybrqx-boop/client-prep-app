import { searchWithOpenAiWeb } from "./openaiClient.js";
import { searchWithAnthropicWeb } from "./anthropicClient.js";

export interface PromptVariant {
  label: string;
  build: (name: string, company: string, title?: string) => string;
}

// These prompts are copied verbatim from tools/attendeeResearch.ts so the
// comparison reflects exactly what the live code asks each provider.
export const VARIANTS: PromptVariant[] = [
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

export interface ProviderRunResult {
  outputText: string;
  citations: Array<{ url: string; title?: string }>;
  latencyMs: number;
  error?: string;
  model?: string;
}

export interface VariantResult {
  variant: string;
  prompt: string;
  skipped?: string;
  openai?: ProviderRunResult;
  anthropic?: ProviderRunResult;
}

export interface ComparisonResult {
  name: string;
  company: string;
  title?: string;
  variants: VariantResult[];
}

async function timed<
  T extends {
    outputText: string;
    citations: Array<{ url: string; title?: string }>;
    model?: string;
  }
>(call: () => Promise<T>): Promise<ProviderRunResult> {
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

export async function compareAttendeeSearch(
  name: string,
  company: string,
  title?: string
): Promise<ComparisonResult> {
  const variants: VariantResult[] = [];

  for (const variant of VARIANTS) {
    if (variant.label === "title-aware" && !title) {
      variants.push({
        variant: variant.label,
        prompt: "",
        skipped: "Pass a title to run the title-aware variant."
      });
      continue;
    }

    const prompt = variant.build(name, company, title);
    const [openai, anthropic] = await Promise.all([
      timed(() =>
        searchWithOpenAiWeb(prompt).then((r) => ({ ...r, model: undefined }))
      ),
      timed(() => searchWithAnthropicWeb(prompt))
    ]);

    variants.push({ variant: variant.label, prompt, openai, anthropic });
  }

  return { name, company, title, variants };
}
