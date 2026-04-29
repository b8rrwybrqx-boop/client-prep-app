import { callResponsesApi, getOpenAiConfig } from "./openaiClient.js";
import { buildPrompt } from "./buildPrompt.js";
import {
  buildResearchPacket,
  type ClientPrepFormInput,
  type ResearchPacket
} from "./buildResearchPacket.js";
import {
  enforceBriefQuality,
  type BriefQualityReport
} from "./enforceBriefQuality.js";

export interface ClientPrepResult {
  markdown: string;
  rawModelText: string;
  researchPacket: ResearchPacket;
  qualityReport: BriefQualityReport;
  meta: {
    model: string;
    generatedAt: string;
  };
}

export interface ClientPrepPhase1Result {
  phase1Markdown: string;
  rawModelText: string;
  researchPacket: ResearchPacket;
  qualityReport: BriefQualityReport;
  meta: {
    model: string;
    generatedAt: string;
  };
}

export interface ClientPrepPhase2Result {
  phase2Markdown: string;
  rawModelText: string;
  sources: string[];
  qualityReport: BriefQualityReport;
  meta: {
    model: string;
    generatedAt: string;
  };
}

function isValidSourceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    if (!/^https?:$/.test(parsed.protocol)) {
      return false;
    }

    return parsed.hostname.includes(".");
  } catch {
    return false;
  }
}

function collectSourceLinks(researchPacket: ResearchPacket): string[] {
  const urls = Array.from(
    new Set(
      [
        ...researchPacket.companyFacts.sources,
        ...researchPacket.brands.sources,
        ...researchPacket.mna.sources,
        ...researchPacket.attendeeFacts.flatMap((attendee) => attendee.sources)
      ]
        .filter(Boolean)
        .filter(isValidSourceUrl)
    )
  );

  return urls.slice(0, 12);
}

function sourceLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

function appendSourcesSection(markdown: string, researchPacket: ResearchPacket): string {
  const sources = collectSourceLinks(researchPacket);

  if (sources.length === 0 || /\n## Sources\b/i.test(markdown)) {
    return markdown;
  }

  const sourceLines = sources.map(
    (url, index) => `- [${sourceLabel(url)} ${index + 1}](${url})`
  );

  return `${markdown.trim()}\n\n## Sources\n${sourceLines.join("\n")}`.trim();
}

function buildRepairPacket(researchPacket: ResearchPacket): object {
  return {
    input: researchPacket.input,
    attendeeFacts: researchPacket.attendeeFacts.map((attendee) => ({
      name: attendee.name,
      verifiedTitle: attendee.verifiedTitle,
      verifiedRole: attendee.verifiedRole,
      background: attendee.background,
      sourceType: attendee.sourceType,
      note: attendee.note,
      inferredPriorities: attendee.inferredPriorities
    })),
    latestDevelopments: researchPacket.latestDevelopments,
    leadershipChanges: researchPacket.leadershipChanges,
    strategicSignals: researchPacket.strategicSignals,
    keyConstraints: researchPacket.keyConstraints,
    portfolioChanges: researchPacket.portfolioChanges,
    restructuringSignals: researchPacket.restructuringSignals,
    governanceSignals: researchPacket.governanceSignals,
    brands: researchPacket.brands.brands
  };
}

function shouldRepairBrief(
  markdown: string,
  report: BriefQualityReport
): boolean {
  const trimmed = markdown.trim();

  return (
    trimmed.endsWith("-") ||
    /[-*]\s*$/.test(trimmed) ||
    report.missingSections.length > 0 ||
    report.underfilledSections.length > 0
  );
}

function sanitizeRepairOutput(markdown: string): string {
  return markdown
    .replace(/^# .+\n+/m, "")
    .replace(/^Assumption:.*\n+/m, "")
    .trim();
}

export async function generateClientPrepPhase1(
  input: ClientPrepFormInput
): Promise<ClientPrepPhase1Result> {
  const researchPacket = await buildResearchPacket(input);
  return generateClientPrepPhase1FromPacket(researchPacket);
}

export async function generateClientPrepPhase1FromPacket(
  researchPacket: ResearchPacket
): Promise<ClientPrepPhase1Result> {
  const promptPayload = await buildPrompt(researchPacket, { phase: "phase1" });
  const config = getOpenAiConfig();
  const response = await callResponsesApi({
    model: config.model,
    instructions: promptPayload.systemPrompt,
    inputText: promptPayload.inputText
  });
  let combinedRawText = response.outputText.trim();
  let qualityPass = enforceBriefQuality(combinedRawText, researchPacket, {
    phase: "phase1"
  });

  if (shouldRepairBrief(qualityPass.markdown, qualityPass.report)) {
    const sectionsToRepair = Array.from(
      new Set([
        ...qualityPass.report.missingSections,
        ...qualityPass.report.underfilledSections
      ])
    );

    const repairResponse = await callResponsesApi({
      model: config.model,
      instructions: promptPayload.systemPrompt,
      inputText: [
        "The previous Phase 1 brief was incomplete or missing required sections.",
        "Return only the sections below as markdown.",
        "If a listed section already exists but is thin, rewrite that full section so it is complete.",
        "Do not repeat the title or assumption line.",
        "Use only these sections:",
        sectionsToRepair.map((section) => `- ${section}`).join("\n"),
        "",
        "Existing partial brief:",
        combinedRawText,
        "",
        "Compact research packet:",
        JSON.stringify(buildRepairPacket(researchPacket), null, 2)
      ].join("\n")
    });

    combinedRawText = `${combinedRawText}\n\n${sanitizeRepairOutput(
      repairResponse.outputText
    )}`.trim();
    qualityPass = enforceBriefQuality(combinedRawText, researchPacket, {
      phase: "phase1"
    });
  }

  return {
    phase1Markdown: qualityPass.markdown,
    rawModelText: combinedRawText,
    researchPacket,
    qualityReport: qualityPass.report,
    meta: {
      model: response.model,
      generatedAt: response.generatedAt
    }
  };
}

export async function generateClientPrepPhase2(
  researchPacket: ResearchPacket,
  phase1Markdown: string
): Promise<ClientPrepPhase2Result> {
  const promptPayload = await buildPrompt(researchPacket, {
    phase: "phase2",
    phase1Markdown
  });
  const config = getOpenAiConfig();
  const response = await callResponsesApi({
    model: config.model,
    instructions: promptPayload.systemPrompt,
    inputText: promptPayload.inputText
  });
  let combinedRawText = response.outputText.trim();
  let qualityPass = enforceBriefQuality(combinedRawText, researchPacket, {
    phase: "phase2"
  });

  if (shouldRepairBrief(qualityPass.markdown, qualityPass.report)) {
    const sectionsToRepair = Array.from(
      new Set([
        ...qualityPass.report.missingSections,
        ...qualityPass.report.underfilledSections
      ])
    );

    const repairResponse = await callResponsesApi({
      model: config.model,
      instructions: promptPayload.systemPrompt,
      inputText: [
        "The previous Phase 2 brief was incomplete or missing required sections.",
        "Return only the sections below as markdown.",
        "If a listed section already exists but is thin, rewrite that full section so it is complete.",
        "Do not repeat the title or assumption line.",
        "Use only these sections:",
        sectionsToRepair.map((section) => `- ${section}`).join("\n"),
        "",
        "Existing partial Phase 2 output:",
        combinedRawText,
        "",
        "Phase 1 brief (reference only):",
        phase1Markdown,
        "",
        "Compact research packet:",
        JSON.stringify(buildRepairPacket(researchPacket), null, 2)
      ].join("\n")
    });

    combinedRawText = `${combinedRawText}\n\n${sanitizeRepairOutput(
      repairResponse.outputText
    )}`.trim();
    qualityPass = enforceBriefQuality(combinedRawText, researchPacket, {
      phase: "phase2"
    });
  }

  return {
    phase2Markdown: qualityPass.markdown,
    rawModelText: combinedRawText,
    sources: collectSourceLinks(researchPacket),
    qualityReport: qualityPass.report,
    meta: {
      model: response.model,
      generatedAt: response.generatedAt
    }
  };
}

export async function generateClientPrep(
  input: ClientPrepFormInput
): Promise<ClientPrepResult> {
  const phase1 = await generateClientPrepPhase1(input);
  const phase2 = await generateClientPrepPhase2(
    phase1.researchPacket,
    phase1.phase1Markdown
  );

  const combined = `${phase1.phase1Markdown}\n\n${phase2.phase2Markdown}`.trim();
  const finalMarkdown = appendSourcesSection(combined, phase1.researchPacket);

  return {
    markdown: finalMarkdown,
    rawModelText: `${phase1.rawModelText}\n\n${phase2.rawModelText}`.trim(),
    researchPacket: phase1.researchPacket,
    qualityReport: {
      missingSections: [
        ...phase1.qualityReport.missingSections,
        ...phase2.qualityReport.missingSections
      ],
      underfilledSections: [
        ...phase1.qualityReport.underfilledSections,
        ...phase2.qualityReport.underfilledSections
      ],
      appliedFixes: [
        ...phase1.qualityReport.appliedFixes,
        ...phase2.qualityReport.appliedFixes
      ],
      packetWarnings: phase2.qualityReport.packetWarnings
    },
    meta: {
      model: phase2.meta.model,
      generatedAt: phase2.meta.generatedAt
    }
  };
}
