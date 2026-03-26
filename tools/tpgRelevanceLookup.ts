export interface TpgRelevanceResult {
  summary: string[];
  suggestedProjectTypes: string[];
  fitNotes: string[];
  derivedFrom: string[];
}

export async function tpgRelevanceLookup(
  researchPacket: object
): Promise<TpgRelevanceResult> {
  // TODO: Replace with live TPG fit logic and knowledge-driven scoring.
  const packet = researchPacket as { input?: { company?: string } };
  const company = packet.input?.company ?? "the company";

  return {
    summary: [
      `Assess where ${company} fits against TPG practice areas and project types.`
    ],
    suggestedProjectTypes: ["Growth strategy", "Portfolio acceleration"],
    fitNotes: [
      "Add a concise rationale for why this opportunity may matter to TPG."
    ],
    derivedFrom: [
      "Current fit logic is placeholder-only and not knowledge-backed yet."
    ]
  };
}
