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

function normalizeSectionKey(line: string): string {
  return line
    .replace(/^#+\s*/, "")
    .trim()
    .toLowerCase();
}

function splitMarkdownSections(markdown: string): {
  title: string | null;
  intro: string[];
  sections: Array<{ heading: string; lines: string[] }>;
} {
  const lines = markdown.split(/\r?\n/);
  let title: string | null = null;
  const intro: string[] = [];
  const sections: Array<{ heading: string; lines: string[] }> = [];
  let currentSection: { heading: string; lines: string[] } | null = null;

  for (const line of lines) {
    if (line.startsWith("# ")) {
      title = line;
      continue;
    }

    if (line.startsWith("## ")) {
      currentSection = { heading: line, lines: [] };
      sections.push(currentSection);
      continue;
    }

    if (currentSection) {
      currentSection.lines.push(line);
    } else {
      intro.push(line);
    }
  }

  return { title, intro, sections };
}

function compactSecondarySignals(signals: string[]): string {
  const cleaned = Array.from(
    new Set(
      signals
        .slice(0, 3)
        .map((signal) => signal.replace(/^[^:]+:\s*/, "").trim())
        .map((signal) => signal.replace(/\s+/g, " ").trim())
        .filter(Boolean)
    )
  );

  return cleaned.join(" ");
}

function relevantLeadership(leaders: string[]): string[] {
  return leaders
    .filter((leader) =>
      /(chief executive officer|ceo|chief financial officer|cfo|chief operating officer|coo|chief marketing officer|cmo|president)/i.test(
        leader
      )
    )
    .slice(0, 4);
}

function displayName(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function summarizeStakeholderBackground(
  attendee: ResearchPacket["attendeeFacts"][number]
): string {
  const signals = Array.from(new Set((attendee.secondarySignals ?? []).filter(Boolean)));

  if (signals.length === 0) {
    return "Treat title and remit as unverified.";
  }

  return compactSecondarySignals(signals) || "Secondary public traces suggest a relevant function, but current role details remain unconfirmed.";
}

function buildAttendeeBlock(
  attendee: ResearchPacket["attendeeFacts"][number],
  company: string
): string[] {
  const lines: string[] = [];

  if (attendee.sourceType === "company-page" || attendee.sourceType === "company-news") {
    const verifiedDetail = attendee.verifiedTitle
      ? `${displayName(attendee.name)}, ${attendee.verifiedTitle}`
      : "Company-owned leadership page match found; title not listed on the accessible page";
    lines.push(`- Verified: ${verifiedDetail}`);
    lines.push(
      `- Background: ${attendee.background ?? attendee.verifiedRole ?? "Role details beyond the page listing were not captured in the packet."}`
    );
  } else if ((attendee.secondarySignals?.length ?? 0) > 0) {
    lines.push(
      `- Verified: Publicly indexed sources suggest a likely ${displayName(company)} / ${displayName(attendee.name)} match; current title should be treated as unconfirmed.`
    );
    lines.push(`- Background: ${summarizeStakeholderBackground(attendee)}`);
  } else {
    lines.push(
      `- Verified: No clear attendee/company match found on company-owned or secondary public sources.`
    );
    lines.push(`- Background: Treat title and remit as unverified.`);
  }

  lines.push(
    `- Likely Priorities: ${attendee.inferredPriorities[0] ?? "Clarify scope, decision rights, and current business priorities early."}`
  );
  lines.push(
    `- Likely Lens: ${attendee.inferredPriorities[1] ?? "Practical outcomes tied to near-term business impact and clear ownership."}`
  );

  return lines;
}

function buildStakeholderSection(researchPacket: ResearchPacket): string {
  const { attendeeFacts, companyFacts, input } = researchPacket;
  const leadership = relevantLeadership(companyFacts.leadership);

  if (attendeeFacts.length === 0) {
    return "";
  }

  const lines = ["## Stakeholder"];
  const multipleAttendees = attendeeFacts.length > 1;

  for (const attendee of attendeeFacts) {
    if (multipleAttendees) {
      lines.push(`### ${displayName(attendee.name)}`);
    }
    lines.push(...buildAttendeeBlock(attendee, input.company));
  }

  if (leadership.length > 0) {
    lines.push("### Additional Leadership Context");
    for (const leader of leadership) {
      lines.push(`- Leaders: ${leader}`);
    }
  }

  return lines.join("\n");
}

function replaceStakeholderSection(
  markdown: string,
  researchPacket: ResearchPacket
): string {
  const replacement = buildStakeholderSection(researchPacket);

  if (!replacement) {
    return markdown;
  }

  const { title, intro, sections } = splitMarkdownSections(markdown);
  const rebuiltSections: string[] = [];
  let replaced = false;

  for (const section of sections) {
    const key = normalizeSectionKey(section.heading);

    if (key === "stakeholder") {
      rebuiltSections.push(replacement);
      replaced = true;
      continue;
    }

    if (key === "additional stakeholders" || key === "additional leadership context") {
      continue;
    }

    rebuiltSections.push([section.heading, ...section.lines].join("\n").trimEnd());
  }

  if (!replaced) {
    rebuiltSections.push(replacement);
  }

  return [title ?? "", intro.join("\n").trim(), rebuiltSections.join("\n\n")]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function collectSourceLinks(researchPacket: ResearchPacket): string[] {
  const urls = Array.from(
    new Set(
      [
        ...researchPacket.companyFacts.sources,
        ...researchPacket.brands.sources,
        ...researchPacket.mna.sources,
        ...researchPacket.attendeeFacts.flatMap((attendee) => attendee.sources)
      ].filter(Boolean)
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

export async function generateClientPrep(
  input: ClientPrepFormInput
): Promise<ClientPrepResult> {
  const researchPacket = await buildResearchPacket(input);
  const promptPayload = await buildPrompt(researchPacket);
  const config = getOpenAiConfig();
  const response = await callResponsesApi({
    model: config.model,
    instructions: promptPayload.systemPrompt,
    inputText: promptPayload.inputText
  });
  let combinedRawText = response.outputText.trim();
  let qualityPass = enforceBriefQuality(combinedRawText, researchPacket);

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
        "The previous brief was incomplete or missing required sections.",
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
    qualityPass = enforceBriefQuality(combinedRawText, researchPacket);
  }

  const stakeholderNormalized = replaceStakeholderSection(
    qualityPass.markdown,
    researchPacket
  );

  return {
    markdown: appendSourcesSection(stakeholderNormalized, researchPacket),
    rawModelText: combinedRawText,
    researchPacket,
    qualityReport: qualityPass.report,
    meta: {
      model: response.model,
      generatedAt: response.generatedAt
    }
  };
}
