import { callResponsesApi } from "./openaiClient.js";

export async function runWithFunctionCalling(): Promise<void> {
  // Future / optional scaffold only.
  // The v1 app runs local research tools first, then sends one final prompt.
  // If you enable tool calling later, the flow is:
  // 1. Send a Responses API request with `tools`.
  // 2. Inspect `response.output`.
  // 3. Find items where `type === "function_call"`.
  // 4. Execute the matching local function with parsed `arguments`.
  // 5. Send a follow-up Responses API call that includes:
  //    `{ type: "function_call_output", call_id, output }`
  // 6. Read the final markdown from the next response.
  await callResponsesApi({
    instructions: "Placeholder only.",
    inputText: "This function is not wired into the main path yet."
  });
}
