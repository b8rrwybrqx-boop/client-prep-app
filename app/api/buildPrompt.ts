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
          "Stakeholder Context section instructions:",
          `- Attendees to write up: ${researchPacket.input.attendees.join(", ")}`,
          `- Company to cross-reference: ${researchPacket.input.company}`,
          "- For each attendee, write a tight block of label-first bullets. Default labels: **Verified:**, **Background:**, **Likely Priorities:**, **Likely Lens:**.",
          "- If the brief includes more than one attendee, give each their own ### sub-heading using the attendee's full name in Title Case (e.g., 'Jimmy Jia', 'Mike Hayes'), even when the input was lowercase or stylized.",
          "- VERIFIED line: state the attendee's title and remit in one sentence. If the title comes from a company-owned page (sourceType company-page or company-news), present it as verified.",
          "- If the title was sourced via OpenAI web search, treat any company-owned domain (press release on the company's own corporate or investor site) as verified. Cite the source briefly inline, e.g. 'per 8/4/2025 PetSmart corporate press release'.",
          "- If only directory or aggregator evidence is available (sourceType secondary-profile, no company-owned URL), phrase the title as 'reported by secondary public sources' and note that current title should be treated as unconfirmed.",
          "- If sourceType is not-found and there are no secondarySignals, say no clear attendee/company match was found and keep the section useful via inferredPriorities.",
          "- BACKGROUND line: synthesize the strongest 1-2 facts from `background`, `secondarySignals`, and `notes`. Combine into one sentence in your own words. Do NOT paste raw signals verbatim. Do NOT repeat the same fact more than once even if it appears in multiple signals.",
          "- LIKELY PRIORITIES / LENS lines: be specific to this attendee's actual remit, not the rule-based defaults. If the packet shows their remit covers, e.g., proprietary brands and merchandising, the priorities should reflect that — not generic CCO talking points.",
          "- Do not echo raw field names like sourceType, confidence, verificationLevel, or verificationLevel in the prose.",
          "- Keep each attendee block to 4-5 bullets. If something is unverified, say so briefly and move on.",
          "- If named attendee verification is fully unavailable, add a short leadership fallback using 2-4 relevant named executives from companyFacts.leadership under a clearly labelled '### Additional Leadership Context' subheading. Do not imply those executives are confirmed meeting attendees."
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
