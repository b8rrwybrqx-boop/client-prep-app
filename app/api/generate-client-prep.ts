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
  const qualityPass = enforceBriefQuality(response.outputText, researchPacket);

  return {
    markdown: qualityPass.markdown,
    rawModelText: response.outputText.trim(),
    researchPacket,
    qualityReport: qualityPass.report,
    meta: {
      model: response.model,
      generatedAt: response.generatedAt
    }
  };
}
