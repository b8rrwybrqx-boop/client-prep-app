import type { AttendeeResearchResult } from "../../tools/attendeeResearch.js";
import type { BrandPortfolioResult } from "../../tools/brandPortfolioCheck.js";
import type { CompanyResearchResult } from "../../tools/companyResearch.js";
import type { RecentMnaResult } from "../../tools/recentMnaCheck.js";
import type { TpgRelevanceResult } from "../../tools/tpgRelevanceLookup.js";
import { attendeeResearch } from "../../tools/attendeeResearch.js";
import { brandPortfolioCheck } from "../../tools/brandPortfolioCheck.js";
import { companyResearch } from "../../tools/companyResearch.js";
import { recentMnaCheck } from "../../tools/recentMnaCheck.js";
import { tpgRelevanceLookup } from "../../tools/tpgRelevanceLookup.js";

export interface ClientPrepFormInput {
  company: string;
  attendees: string;
  meetingObjective?: string;
  notes?: string;
}

export interface NormalizedInput {
  company: string;
  attendees: string[];
  meetingObjective: string;
  notes: string;
}

export interface ResearchPacket {
  input: NormalizedInput;
  companyFacts: CompanyResearchResult;
  brands: BrandPortfolioResult;
  mna: RecentMnaResult;
  attendeeFacts: AttendeeResearchResult[];
  latestDevelopments: string[];
  leadershipChanges: string[];
  strategicSignals: string[];
  keyConstraints: string[];
  concentrationRisks: string[];
  proofPoints: string[];
  portfolioChanges: string[];
  restructuringSignals: string[];
  governanceSignals: string[];
  tpgRelevance: TpgRelevanceResult;
  verificationSummary: {
    checksPerformed: string[];
    limitations: string[];
    assumptions: string[];
  };
}

function normalizeAttendees(rawAttendees: string): string[] {
  return rawAttendees
    .split(/\r?\n|,/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function cleanPacketItems(items: string[]): string[] {
  return Array.from(
    new Set(
      items
        .map((item) => item.trim())
        .filter(
          (item) =>
            item &&
            !/^no material portfolio change was extracted/i.test(item) &&
            !/^official-site signal extraction was limited/i.test(item) &&
            !/^(corporate governance|management|investor news|quarterly results)$/i.test(
              item
            ) &&
            !/^(chief|president|senior vice president|executive vice president|general counsel)\b/i.test(
              item
            )
        )
    )
  );
}

export async function buildResearchPacket(
  input: ClientPrepFormInput
): Promise<ResearchPacket> {
  const normalizedInput: NormalizedInput = {
    company: input.company.trim(),
    attendees: normalizeAttendees(input.attendees),
    meetingObjective: input.meetingObjective?.trim() ?? "",
    notes: input.notes?.trim() ?? ""
  };

  const [companyFacts, brands, mna, attendeeFacts] = await Promise.all([
    companyResearch(normalizedInput.company),
    brandPortfolioCheck(normalizedInput.company),
    recentMnaCheck(normalizedInput.company),
    attendeeResearch(normalizedInput.attendees, normalizedInput.company)
  ]);

  const partialResearchPacket = {
    input: normalizedInput,
    companyFacts,
    brands,
    mna,
    attendeeFacts
  };

  const promotedDevelopments = [
    ...(companyFacts.keyConstraints ?? []).filter((item) =>
      /strengthens leadership team|reports .* financial results|strategic appointments/i.test(
        item
      )
    )
  ];
  const latestDevelopments = cleanPacketItems([
    ...(companyFacts.latestDevelopments ?? []),
    ...promotedDevelopments,
    ...mna.items,
    ...mna.notes.filter((note) =>
      /acquisition|appoints|ceo|portfolio|ownership|expansion/i.test(note)
    )
  ]);
  const leadershipChanges = cleanPacketItems([
    ...(companyFacts.leadershipChanges ?? []),
    ...promotedDevelopments.filter((item) =>
      /leadership|appoints|ceo|chief|strategic appointments/i.test(item)
    ),
    ...mna.items.filter((item) => /ceo|president|chief|leadership|appoints/i.test(item)),
    ...mna.notes.filter((note) => /succeeds|appoints|new ceo|leadership/i.test(note))
  ]);
  const strategicSignals = cleanPacketItems([
    ...(companyFacts.strategicSignals ?? []),
    ...companyFacts.signals
  ]);
  const keyConstraints = cleanPacketItems([...(companyFacts.keyConstraints ?? [])]);
  const concentrationRisks = cleanPacketItems([
    ...(companyFacts.concentrationRisks ?? [])
  ]);
  const proofPoints = cleanPacketItems([
    ...(companyFacts.proofPoints ?? []),
    ...companyFacts.signals.filter((signal) => /\d/.test(signal))
  ]);
  const portfolioChanges = cleanPacketItems([
    ...mna.items.filter((item) =>
      /divest|portfolio|brand|business unit|simplification|spin|sale|sold/i.test(item)
    ),
    ...mna.notes.filter((note) =>
      /divest|portfolio|brand|business unit|simplification|spin|sale|sold/i.test(note)
    )
  ]);
  const restructuringSignals = cleanPacketItems([
    ...latestDevelopments.filter((item) =>
      /restructur|simplification|cost savings|productivity|margin improvement|turnaround|transformation/i.test(
        item
      )
    ),
    ...keyConstraints.filter((item) =>
      /restructur|simplification|cost savings|productivity|margin improvement|turnaround|transformation/i.test(
        item
      )
    ),
    ...mna.notes.filter((note) =>
      /restructur|simplification|cost savings|productivity|margin improvement|turnaround|transformation/i.test(
        note
      )
    )
  ]);
  const governanceSignals = cleanPacketItems([
    ...latestDevelopments.filter((item) =>
      /board|activist|governance|ownership|proxy|investor pressure/i.test(item)
    ),
    ...mna.items.filter((item) =>
      /board|activist|governance|ownership|proxy|investor pressure/i.test(item)
    ),
    ...mna.notes.filter((note) =>
      /board|activist|governance|ownership|proxy|investor pressure/i.test(note)
    )
  ]);

  const tpgRelevance = await tpgRelevanceLookup(partialResearchPacket);
  const checksPerformed = [
    ...companyFacts.sourceChecks,
    ...brands.sourceChecks,
    ...mna.sourceChecks,
    ...attendeeFacts.flatMap((attendee) => attendee.sourceChecks),
    ...tpgRelevance.derivedFrom
  ];
  const limitations = [
    ...companyFacts.gaps,
    ...brands.notes.filter((note) => note.includes("stubbed") || note.includes("Add ")),
    ...mna.notes.filter((note) => note.includes("No live") || note.includes("Add ")),
    ...attendeeFacts.flatMap((attendee) =>
      attendee.notes.filter((note) => note.includes("Add "))
    )
  ];
  const assumptions = [
    normalizedInput.meetingObjective
      ? `Meeting objective provided: ${normalizedInput.meetingObjective}`
      : "Meeting objective not provided; the brief may infer likely discussion priorities.",
    normalizedInput.notes
      ? `Notes provided: ${normalizedInput.notes}`
      : "No extra notes provided; emphasis depends on available company and attendee context."
  ];

  return {
    input: normalizedInput,
    companyFacts,
    brands,
    mna,
    attendeeFacts,
    latestDevelopments,
    leadershipChanges,
    strategicSignals,
    keyConstraints,
    concentrationRisks,
    proofPoints,
    portfolioChanges,
    restructuringSignals,
    governanceSignals,
    tpgRelevance,
    verificationSummary: {
      checksPerformed,
      limitations,
      assumptions
    }
  };
}
