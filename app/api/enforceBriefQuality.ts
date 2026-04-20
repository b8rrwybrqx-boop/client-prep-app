import type { ResearchPacket } from "./buildResearchPacket.js";

export interface BriefQualityReport {
  missingSections: string[];
  underfilledSections: string[];
  appliedFixes: string[];
  packetWarnings: string[];
}

const blockedSections = new Set([
  "header",
  "formatting rules",
  "visual / ux intent for app rendering",
  "visual / ux intent",
  "content prioritization rules"
]);

const requiredSections = [
  "Company Snapshot",
  "Competitive Context",
  "Macro Industry / Ecosystem Context",
  "Category / Segment Context",
  "Stakeholder Context",
  "Likely Priorities / Implications",
  "What TPG Should Emphasize",
  "Recommended Questions",
  "Meeting Context",
  "Suggested Next-Step Direction"
] as const;

const sectionAliases: Record<string, string> = {
  "macro industry / ecosystem": "Macro Industry / Ecosystem Context",
  "macro industry / ecosystem context": "Macro Industry / Ecosystem Context",
  "stakeholder context": "Stakeholder Context",
  "stakeholder context — jane smith": "Stakeholder Context",
  "stakeholder context - jane smith": "Stakeholder Context",
  "what tpg may have a credible angle": "What TPG Should Emphasize",
  "where tpg may have a credible angle": "What TPG Should Emphasize",
  "good questions to ask": "Recommended Questions",
  "best questions to ask": "Recommended Questions",
  "likely priorities / implications for the discussion":
    "Likely Priorities / Implications",
  "meeting snapshot": "Meeting Context",
  "suggested meeting posture": "Suggested Next-Step Direction"
};

const sectionDisplayLabels: Record<string, string> = {
  "Competitive Context": "Competition",
  "Macro Industry / Ecosystem Context": "Macro Environment",
  "Category / Segment Context": "Category / Segment",
  "Stakeholder Context": "Stakeholder",
  "Likely Priorities / Implications": "Priorities / Implications",
  "What TPG Should Emphasize": "TPG Angle",
  "Recommended Questions": "Questions"
};

function normalizeSectionLabel(value: string): string {
  const normalized = value
    .replace(/^[-*]\s+/, "")
    .replace(/^[#\d.)\s-]+/, "")
    .replace(/:$/, "")
    .trim();

  const lowered = normalized.toLowerCase();
  const directAlias = sectionAliases[lowered];

  if (directAlias) {
    return directAlias;
  }

  for (const section of requiredSections) {
    const prefix = section.toLowerCase();

    if (
      lowered.startsWith(`${prefix} — `) ||
      lowered.startsWith(`${prefix} - `) ||
      lowered.startsWith(`${prefix}: `)
    ) {
      return section;
    }
  }

  return normalized;
}

function isRecognizedSectionLabel(value: string): boolean {
  const normalized = normalizeSectionLabel(value);

  return requiredSections.includes(
    normalized as (typeof requiredSections)[number]
  );
}

function displaySectionLabel(value: string): string {
  return sectionDisplayLabels[value] ?? value;
}

function formatBullet(line: string, index: number, section: string): string {
  const value = line.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "").trim();

  if (!value) {
    return "";
  }

  if (value.includes(":")) {
    return `- ${value}`;
  }

  if (section === "Recommended Questions") {
    return `- Question ${index + 1}: ${value}`;
  }

  return `- Point: ${value}`;
}

function cleanBulletValue(value: string): string {
  return value
    .replace(/\b(public facts compiled through [A-Za-z]{3,9}\s+\d{4};?\s*)/gi, "")
    .replace(/\b(as of prep|in provided materials)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,;:.])/g, "$1")
    .trim();
}

function packetWarnings(packet: ResearchPacket): string[] {
  const warnings: string[] = [];

  if (packet.companyFacts.gaps.length > 0) {
    warnings.push(...packet.companyFacts.gaps);
  }

  if (packet.brands.brands.includes("Primary brand information pending")) {
    warnings.push("Brand portfolio is still placeholder-level.");
  }

  if (packet.attendeeFacts.some((attendee) => attendee.sourceType === "not-found")) {
    warnings.push("One or more attendee titles are still unverified.");
  }

  if (
    packet.attendeeFacts.some(
      (attendee) => attendee.sourceType === "secondary-profile"
    )
  ) {
    warnings.push(
      "One or more attendee titles rely on secondary public-profile sources rather than the company site."
    );
  }

  if (packet.companyFacts.leadership.length === 0) {
    warnings.push("Official company leadership roster could not be extracted.");
  }

  if (packet.mna.sourceChecks.some((check) => check.includes("not implemented"))) {
    warnings.push("M&A verification still relies on stub logic.");
  }

  return warnings;
}

export function enforceBriefQuality(
  markdown: string,
  researchPacket: ResearchPacket
): { markdown: string; report: BriefQualityReport } {
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  const seenSections = new Set<string>();
  const sectionBulletCounts = new Map<string, number>();
  const fixes: string[] = [];
  let currentSection = "";
  let bulletIndex = 0;
  let skipSection = false;
  let lastNormalizedBullet = "";

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (!trimmed) {
      output.push("");
      lastNormalizedBullet = "";
      continue;
    }

    const isNumberedHeading =
      currentSection !== "Recommended Questions" &&
      (/^\d+\)\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed));
    const isBulletSectionLabel =
      /^[-*]\s+/.test(trimmed) &&
      !trimmed.includes(":") &&
      isRecognizedSectionLabel(trimmed);
    const isPlainSectionLabel =
      !/^[-*]\s+/.test(trimmed) &&
      !trimmed.includes(":") &&
      isRecognizedSectionLabel(trimmed);
    const isHeading =
      trimmed.startsWith("#") ||
      isNumberedHeading ||
      isPlainSectionLabel ||
      isBulletSectionLabel;

    if (isHeading) {
      const sectionName = normalizeSectionLabel(trimmed);
      const normalizedKey = sectionName.toLowerCase();

      if (blockedSections.has(normalizedKey)) {
        skipSection = true;
        fixes.push(`Removed leaked section: ${sectionName}`);
        continue;
      }

      skipSection = false;

      if (trimmed.startsWith("# ")) {
        output.push(trimmed);
        currentSection = "";
        bulletIndex = 0;
        continue;
      }

      if (trimmed !== `## ${sectionName}`) {
        fixes.push(`Normalized heading: ${sectionName}`);
      }

      output.push(`## ${displaySectionLabel(sectionName)}`);
      seenSections.add(sectionName);
      sectionBulletCounts.set(sectionName, 0);
      currentSection = sectionName;
      bulletIndex = 0;
      lastNormalizedBullet = "";
      continue;
    }

    if (skipSection || trimmed === "---" || trimmed.startsWith("Template:")) {
      continue;
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const cleaned = trimmed.replace(/^([-*]\s+|\d+\.\s+)/, "");
      const formatted = formatBullet(cleanBulletValue(cleaned), bulletIndex, currentSection);

      if (formatted) {
        const dedupeKey = formatted.toLowerCase();

        if (dedupeKey === lastNormalizedBullet) {
          fixes.push(`Removed duplicated bullet in ${currentSection || "output"}`);
          continue;
        }

        if (formatted !== trimmed) {
          fixes.push(`Normalized bullet format in ${currentSection || "output"}`);
        }

        output.push(formatted);
        lastNormalizedBullet = dedupeKey;
        bulletIndex += 1;
        if (currentSection) {
          sectionBulletCounts.set(
            currentSection,
            (sectionBulletCounts.get(currentSection) ?? 0) + 1
          );
        }
      }

      continue;
    }

    if (currentSection) {
      const normalized = formatBullet(cleanBulletValue(trimmed), bulletIndex, currentSection);
      const dedupeKey = normalized.toLowerCase();

      if (dedupeKey === lastNormalizedBullet) {
        fixes.push(`Removed duplicated bullet in ${currentSection}`);
        continue;
      }

      output.push(normalized);
      fixes.push(`Converted paragraph to bullet in ${currentSection}`);
      lastNormalizedBullet = dedupeKey;
      bulletIndex += 1;
      sectionBulletCounts.set(
        currentSection,
        (sectionBulletCounts.get(currentSection) ?? 0) + 1
      );
      continue;
    }

    output.push(trimmed);
  }

  if (
    !seenSections.has("Meeting Context") &&
    researchPacket.input.meetingObjective.trim()
  ) {
    output.push("", "## Meeting Context");
    output.push(`- Purpose: ${researchPacket.input.meetingObjective.trim()}`);
    seenSections.add("Meeting Context");
    fixes.push("Added Meeting Context from request input.");
  }

  const missingSections = requiredSections.filter((section) => !seenSections.has(section));
  const underfilledSections = requiredSections.filter((section) => {
    if (!seenSections.has(section)) {
      return false;
    }

    const count = sectionBulletCounts.get(section) ?? 0;
    const minimum = section === "Meeting Context" ? 1 : 2;
    return count < minimum;
  });

  if (missingSections.length > 0) {
    fixes.push("Detected missing required sections.");
  }

  if (underfilledSections.length > 0) {
    fixes.push("Detected underfilled sections.");
  }

  return {
    markdown: output.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    report: {
      missingSections,
      underfilledSections,
      appliedFixes: Array.from(new Set(fixes)),
      packetWarnings: packetWarnings(researchPacket)
    }
  };
}
