import { readFile } from "node:fs/promises";
import type { ResearchPacket } from "./buildResearchPacket.js";

export type GenerationPhase = "phase1" | "phase2";

export interface PromptPayload {
  systemPrompt: string;
  template: string;
  examples: string[];
  researchPacket: ResearchPacket;
  inputText: string;
}

const PHASE_1_SECTION_LABELS = [
  "Company Snapshot",
  "Competitive Context",
  "Macro Industry / Ecosystem",
  "Category / Segment Context",
  "Stakeholder Context",
  "Likely Priorities / Implications"
];

const PHASE_2_SECTION_LABELS = [
  "Where TPG May Have a Credible Angle",
  "Good Questions to Ask",
  "Suggested Meeting Posture"
];

function buildPhaseDirective(
  phase: GenerationPhase,
  phase1Markdown?: string
): string {
  if (phase === "phase1") {
    return [
      "OUTPUT SCOPE — PHASE 1 OF 2:",
      "- Begin with the title line and (if applicable) one short assumption note.",
      `- Then output ONLY these sections, in this order: ${PHASE_1_SECTION_LABELS.join(", ")}.`,
      "- Do NOT output 'Where TPG May Have a Credible Angle', 'Good Questions to Ask', or 'Suggested Meeting Posture'. A separate phase will produce those.",
      "- Do NOT output a Sources section; sources will be appended after the second phase."
    ].join("\n");
  }

  return [
    "OUTPUT SCOPE — PHASE 2 OF 2:",
    `- Output ONLY these sections, in this order: ${PHASE_2_SECTION_LABELS.join(", ")}.`,
    "- Do NOT output the title line, the assumption note, or any Phase 1 sections. Phase 1 already produced those.",
    "- Use the Phase 1 brief (provided below) for tone, terminology, and to reference its competitive and stakeholder framing where relevant.",
    "- Do NOT output a Sources section; sources will be appended after this phase.",
    "",
    "PHASE 1 BRIEF (reference only — do not repeat its sections):",
    phase1Markdown?.trim() ?? ""
  ].join("\n");
}

async function loadText(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, import.meta.url), "utf-8");
}

function buildPromptResearchPacket(
  researchPacket: ResearchPacket,
  isVercel: boolean
): object {
  const compactPacket = {
    input: researchPacket.input,
    companyFacts: {
      company: researchPacket.companyFacts.company,
      summary: researchPacket.companyFacts.summary,
      signals: researchPacket.companyFacts.signals.slice(0, 6),
      leadership: researchPacket.companyFacts.leadership.slice(0, 8),
      latestDevelopments: (researchPacket.companyFacts.latestDevelopments ?? []).slice(0, 6),
      leadershipChanges: (researchPacket.companyFacts.leadershipChanges ?? []).slice(0, 4),
      strategicSignals: (researchPacket.companyFacts.strategicSignals ?? []).slice(0, 6),
      keyConstraints: (researchPacket.companyFacts.keyConstraints ?? []).slice(0, 5),
      concentrationRisks: (researchPacket.companyFacts.concentrationRisks ?? []).slice(0, 4),
      proofPoints: (researchPacket.companyFacts.proofPoints ?? []).slice(0, 5)
    },
    brands: {
      brands: researchPacket.brands.brands.slice(0, 20),
      notes: researchPacket.brands.notes.slice(0, 3)
    },
    mna: {
      items: researchPacket.mna.items.slice(0, 6),
      notes: researchPacket.mna.notes.slice(0, 5)
    },
    attendeeFacts: researchPacket.attendeeFacts.map((attendee) => ({
      name: attendee.name,
      verifiedTitle: attendee.verifiedTitle,
      verifiedRole: attendee.verifiedRole,
      background: attendee.background,
      secondarySignals: (attendee.secondarySignals ?? []).slice(0, 4),
      sourceType: attendee.sourceType,
      confidence: attendee.confidence,
      note: attendee.note,
      inferredPriorities: attendee.inferredPriorities.slice(0, 4)
    })),
    latestDevelopments: researchPacket.latestDevelopments.slice(0, 6),
    leadershipChanges: researchPacket.leadershipChanges.slice(0, 4),
    strategicSignals: researchPacket.strategicSignals.slice(0, 6),
    keyConstraints: researchPacket.keyConstraints.slice(0, 5),
    concentrationRisks: researchPacket.concentrationRisks.slice(0, 4),
    proofPoints: researchPacket.proofPoints.slice(0, 5),
    portfolioChanges: researchPacket.portfolioChanges.slice(0, 5),
    restructuringSignals: researchPacket.restructuringSignals.slice(0, 5),
    governanceSignals: researchPacket.governanceSignals.slice(0, 5),
    tpgRelevance: researchPacket.tpgRelevance
  };

  if (isVercel) {
    return compactPacket;
  }

  return {
    ...compactPacket,
    verificationSummary: researchPacket.verificationSummary
  };
}

export async function buildPrompt(
  researchPacket: ResearchPacket,
  options: { phase?: GenerationPhase; phase1Markdown?: string } = {}
): Promise<PromptPayload> {
  const phase = options.phase ?? "phase1";
  const isVercel = process.env.VERCEL === "1";
  const [systemPrompt, templatePrompt, ...exampleResults] = await Promise.all([
    loadText("../../prompts/system.txt"),
    loadText("../../prompts/client-prep-template.md"),
    isVercel ? Promise.resolve("") : loadText("../../prompts/examples/bridges.md").catch(() => ""),
    isVercel ? Promise.resolve("") : loadText("../../prompts/examples/titan.md").catch(() => "")
  ]);

  const examples = exampleResults
    .map((example) => example.trim())
    .filter(Boolean);
  const promptPacket = buildPromptResearchPacket(researchPacket, isVercel);
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
          "- If secondarySignals are present, use them to summarize weak public evidence in plain language, for example: 'Publicly indexed sources tie [name] to [function]. One older directory-style source lists [title A]; another newer source lists [title B]. Current title should be treated as unconfirmed.'",
          "- If sourceType is company-page or company-news, present the title/role as verified company-owned-source information.",
          "- If sourceType is secondary-profile, phrase it clearly as secondary evidence, for example: 'Secondary public-profile sources suggest [title]'.",
          "- Do not echo raw field names like sourceType or confidence in the final brief.",
          "- If an attendee appears on a company-owned page but no clear title is captured, say that briefly in plain language, for example: 'Company-owned leadership page match found; title not listed on the accessible page.'",
          "- If sourceType is not-found but secondarySignals are empty, it is fine to say that no clear attendee/company match was found on company-owned or secondary public sources.",
          "- If sourceType is not-found, keep the stakeholder section useful by using inferredPriorities and a brief note instead of over-indexing on caveats.",
          "- If named attendee verification is incomplete, add a short leadership fallback using 2-4 relevant named executives from companyFacts.leadership.",
          "- Leadership fallback should prefer CEO, CFO, COO, CMO, President, or divisional presidents when available.",
          "- Label that fallback clearly as company leadership context or additional leadership; do not imply those executives are confirmed meeting attendees.",
          "- Keep the attendee block short. One verified note, one background note if available, and one or two interpretation bullets are enough."
        ].join("\n")
      : "";

  const phaseDirective = buildPhaseDirective(phase, options.phase1Markdown);

  const inputText = [
    "Use the following materials to generate a client prep brief in markdown.",
    phaseDirective,
    generationRefinements,
    attendeeInstructions,
    "",
    "Template:",
    templatePrompt.trim(),
    "",
    "Examples are reference patterns only. Reuse structure and tone where helpful, but do not copy details.",
    examples.length > 0 ? `\n${examples.join("\n\n---\n\n")}\n` : "",
    "Research packet JSON:",
    JSON.stringify(promptPacket, null, 2)
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
