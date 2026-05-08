import {
  compareAttendeeSearch,
  type ProviderRunResult,
  type VariantResult
} from "../app/api/compareAttendeeSearch.js";

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

function printProviderBlock(label: string, result?: ProviderRunResult): void {
  if (!result) {
    return;
  }

  const header =
    `  [${label}]` +
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

function printVariant(variantResult: VariantResult): void {
  console.log(`\n=== variant: ${variantResult.variant} ===`);

  if (variantResult.skipped) {
    console.log(`  (skipped — ${variantResult.skipped})`);
    return;
  }

  console.log(indent(variantResult.prompt, "  > "));
  printProviderBlock("OpenAI", variantResult.openai);
  printProviderBlock("Anthropic", variantResult.anthropic);
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

  const result = await compareAttendeeSearch(name, company, title);
  for (const variant of result.variants) {
    printVariant(variant);
  }

  console.log("\nDone.");
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
