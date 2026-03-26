import { readFile } from "node:fs/promises";
import type { ResearchPacket } from "./buildResearchPacket.js";

export interface PromptPayload {
  systemPrompt: string;
  template: string;
  examples: string[];
  researchPacket: ResearchPacket;
  inputText: string;
}

async function loadText(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, import.meta.url), "utf-8");
}

export async function buildPrompt(
  researchPacket: ResearchPacket
): Promise<PromptPayload> {
  const [systemPrompt, templatePrompt, ...exampleResults] = await Promise.all([
    loadText("../../prompts/system.txt"),
    loadText("../../prompts/client-prep-template.md"),
    loadText("../../prompts/examples/bridges.md").catch(() => ""),
    loadText("../../prompts/examples/titan.md").catch(() => "")
  ]);

  const examples = exampleResults
    .map((example) => example.trim())
    .filter(Boolean);
  const generationRefinements = [
    "Generation refinements:",
    "- Prefer company-specific signals from the research packet over generic industry heuristics.",
    "- Use latest developments, leadership changes, strategic signals, proof points, and constraints before defaulting to broad category filler.",
    "- Do not default to 'no M&A' if portfolioChanges, restructuringSignals, or governanceSignals are present; use 'Portfolio Changes' when that is the more accurate label.",
    "- Separate verified information from inference, but keep stakeholder sections practical and useful for meeting prep.",
    "- If title evidence comes from secondary public-profile sources, say that briefly and move on to a useful interpretation.",
    "- If public data is thin, produce the most useful meeting-prep hypothesis possible without pretending certainty.",
    "- Keep caveats brief. Do not let uncertainty dominate the brief when actionable hypotheses are still possible."
  ].join("\n");

  const attendeeInstructions =
    researchPacket.input.attendees.length > 0
      ? [
          "Attendee verification instructions:",
          `- Attendees to verify: ${researchPacket.input.attendees.join(", ")}`,
          `- Company to cross-reference: ${researchPacket.input.company}`,
          "- Check company leadership pages first.",
          "- Then check company-owned newsroom / press / investor pages for the attendee name.",
          "- Only after that should you use secondary public-profile evidence and employee/profile directories.",
          "- Use sourceType, confidence, verifiedTitle, verifiedRole, background, note, and inferredPriorities from the research packet.",
          "- If sourceType is company-page or company-news, present the title/role as verified company-owned-source information.",
          "- If sourceType is secondary-profile, phrase it clearly as secondary evidence, for example: 'Secondary public-profile sources suggest [title]'.",
          "- If sourceType is not-found, keep the stakeholder section useful by using inferredPriorities and a brief note instead of over-indexing on caveats.",
          "- If named attendee verification is incomplete, use the official company leadership roster from the research packet under Additional Stakeholders or company leadership context, but do not imply those executives are confirmed meeting attendees."
        ].join("\n")
      : "";

  const inputText = [
    "Use the following materials to generate a client prep brief in markdown.",
    generationRefinements,
    attendeeInstructions,
    "",
    "Template:",
    templatePrompt.trim(),
    "",
    "Examples are reference patterns only. Reuse structure and tone where helpful, but do not copy details.",
    examples.length > 0 ? `\n${examples.join("\n\n---\n\n")}\n` : "",
    "Research packet JSON:",
    JSON.stringify(researchPacket, null, 2)
  ]
    .filter(Boolean)
    .join("\n");

  return {
    systemPrompt: [systemPrompt.trim(), generationRefinements].join("\n\n"),
    template: templatePrompt.trim(),
    examples,
    researchPacket,
    inputText
  };
}
