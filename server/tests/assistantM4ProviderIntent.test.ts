import { afterEach, beforeAll, describe, expect, jest, test } from "@jest/globals";
import { createHash } from "node:crypto";
import type { ResolvedAiProvider } from "../services/ai/aiProviderResolver";
import type { AssistantOperatorDecision, AssistantOperatorDecisionProvider } from "../services/assistant/operatorRuntime";

// No tenant configuration, database, executor, or confirmation service is available to this harness.
jest.unstable_mockModule("../services/ai/aiProviderResolver", () => ({ aiProviderResolver: { resolveProvider: () => { throw new Error("Ambient provider resolution is forbidden"); } } }));
const noExecution = () => { throw new Error("Decision-only test: preparation and execution are forbidden"); };
jest.unstable_mockModule("../db", () => ({ db: new Proxy({}, { get: noExecution }), pool: new Proxy({}, { get: noExecution }), hasQuoteAttachmentPagesTable: noExecution, hasPageCountStatusColumn: noExecution, probeDatabaseSchema: noExecution }));
jest.unstable_mockModule("../services/reviewedProductionCompletion", () => ({ previewReviewedProductionCompletion: noExecution, ReviewedProductionCompletionError: Error }));
jest.unstable_mockModule("../services/assistant/execution/productionCompletionCommand", () => ({ prepareProductionCompletionCommandArguments: noExecution, productionCompletionCommandName: "production.complete_job" }));

const status = "orders.current_status", readiness = "orders.current_readiness";
const physical = "fulfillment.prepare_physical_readiness", production = "production.prepare_job_completion";
const call = (toolName: string, args: Record<string, unknown>): AssistantOperatorDecision => ({ kind: "call_tools", calls: [{ toolName, arguments: args }] });
const scenarios = [
  { goal: "What is the status of this order?", script: call(status, {}) },
  { goal: "Why are these lights red?", script: call(readiness, { view: "operational" }) },
  { goal: "Set line 2 ready to 50.", script: call(physical, { lineNumber: 2, mode: "target", quantity: 50 }) },
  { goal: "Mark line 2 production complete.", script: call(production, { lineNumber: 2 }) },
  { goal: "Mark everything complete and boxed.", script: { kind: "ask_user", question: "Completing production and boxing are separate operations. Which line and operation do you mean?", missingInformation: ["line", "operation"] } },
] satisfies { goal: string; script: AssistantOperatorDecision }[];

type Input = Parameters<AssistantOperatorDecisionProvider["decide"]>[0];
let tools: Input["toolCatalog"];
beforeAll(async () => {
  const { assistantToolRegistry } = await import("../services/assistant/toolRegistry");
  const { createPhysicalReadinessTool } = await import("../services/assistant/physicalReadinessTool");
  const { createProductionCompletionTool } = await import("../services/assistant/productionCompletionTool");
  tools = [
    ...([status, readiness] as const).map(name => {
      const tool = assistantToolRegistry.get(name)!;
      return { name, description: tool.description, inputSchema: tool.providerInputSchema };
    }),
    ...[createPhysicalReadinessTool(), createProductionCompletionTool()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  ];
  expect(tools.map(tool => tool.name)).toEqual([status, readiness, physical, production]);
});
afterEach(() => { jest.restoreAllMocks(); });

const isolatedEndpoint = "https://scripted.invalid/v1/chat/completions";
// The truthy config field is required by the application. In the scripted path it contains a public
// label, not a credential; fetch is replaced before the real adapter is constructed.
const scriptedConfig: ResolvedAiProvider = { enabled: true, feature: "assistant", mode: "legacy_env", source: "legacy_env", settings: null,
  provider: "openai_compatible", endpoint: isolatedEndpoint, apiKey: "not-a-credential", model: "scripted" };

function verifiedLocalConfig(): ResolvedAiProvider {
  // The pin must be provisioned independently by the owner of the verified non-MAIN credential.
  // Never fall back to managed, user, MAIN, or application database credentials.
  const endpoint = process.env.M4_NON_MAIN_PROVIDER_ENDPOINT, model = process.env.M4_NON_MAIN_PROVIDER_MODEL;
  const key = process.env.M4_NON_MAIN_PROVIDER_API_KEY, pin = process.env.M4_VERIFIED_TEST_KEY_SHA256;
  if (process.env.M4_LIVE_PROVIDER_INTENT !== "1" || process.env.NODE_ENV !== "test" || !key || !model || !endpoint || !pin ||
      createHash("sha256").update(key).digest("hex") !== pin) throw new Error("A verified, pinned non-MAIN provider credential and explicit test opt-in are required");
  if (!/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}\/v1\/chat\/completions$/.test(endpoint)) throw new Error("Only a dedicated loopback chat-completions endpoint is permitted");
  const fetchLocal = globalThis.fetch;
  jest.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
    if (url !== endpoint) throw new Error("Unexpected provider destination");
    return fetchLocal(url, { ...init, redirect: "error" });
  });
  return { ...scriptedConfig, endpoint, model, apiKey: key };
}

async function checkIntent(scenario: typeof scenarios[number], live: boolean) {
  const { ConfiguredAssistantOperatorDecisionProvider } = await import("../services/assistant/operatorDecisionProvider");
  const { OpenAiCompatibleBugReviewProvider } = await import("../services/ai/providers/configuredProvider");
  const { assistantOperatorDecisionSchema } = await import("../services/assistant/operatorRuntime");
  const config = live ? verifiedLocalConfig() : scriptedConfig;
  const script: AssistantOperatorDecision[] = [scenario.script];
  if (scenario.script.kind === "call_tools" && scenario.script.calls[0].toolName === production) {
    script.push({ kind: "complete", response: "Review the production completion for line 2 and select GO to confirm. Nothing has changed." });
  }
  if (!live) jest.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    expect(url).toBe(isolatedEndpoint);
    const body = JSON.parse(String(init?.body));
    expect(body.messages[0].role).toBe("system");
    const prompt = JSON.parse(body.messages.at(-1).content);
    expect(prompt.goal).toBe(scenario.goal);
    expect(prompt.tools).toEqual(tools);
    expect(prompt.activeTask.entityReferences).toContainEqual({ type: "order", id: "synthetic-order" });
    const next = script.shift();
    if (!next) throw new Error("Unexpected additional provider decision");
    return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(next) } }] });
  });
  const provider = new ConfiguredAssistantOperatorDecisionProvider("synthetic-org", new OpenAiCompatibleBugReviewProvider(), { resolveProvider: async () => config });
  const input: Input = { goal: scenario.goal, taskId: "synthetic-task", step: 1, remainingSteps: 2, toolCatalog: tools, safeWorkingSummary: null,
    observations: [], task: { id: "synthetic-task", domain: "orders", canonicalProductIntentProposalId: null, entityReferences: [{ type: "order", id: "synthetic-order" }] } };
  const decision = assistantOperatorDecisionSchema.parse(await provider.decide(input));
  switch (scenario.goal) {
    case "What is the status of this order?": expect(decision.kind === "call_tools" && decision.calls).toEqual([{ toolName: status, arguments: {} }]); break;
    case "Why are these lights red?":
      expect(decision.kind === "call_tools" && decision.calls.length === 1 && decision.calls[0].toolName === readiness &&
        (!Object.keys(decision.calls[0].arguments).length || JSON.stringify(decision.calls[0].arguments) === '{"view":"operational"}')).toBe(true); break;
    case "Set line 2 ready to 50.":
      if (decision.kind === "ask_user") expect(decision.question).toMatch(/reason|why|justification/i);
      else expect(decision.kind === "call_tools" && decision.calls).toEqual([{ toolName: physical, arguments: { lineNumber: 2, mode: "target", quantity: 50 } }]);
      break;
    case "Mark line 2 production complete.": {
      expect(decision.kind === "call_tools" && decision.calls).toEqual([{ toolName: production, arguments: { lineNumber: 2 } }]);
      // Synthetic preparation observation, NOT a tool dispatch or execution receipt.
      const after = assistantOperatorDecisionSchema.parse(await provider.decide({ ...input, step: 2, remainingSteps: 1,
        observations: [{ step: 1, toolName: production, status: "succeeded", result: { status: "succeeded", data: { response: "Line 2 production completion is prepared for review only. GO required. Nothing changed." } } }] }));
      const text = after.kind === "complete" ? after.response : after.kind === "ask_user" ? after.question : "";
      expect(text).toMatch(/\bGO\b/i);
      expect(text).not.toMatch(/(?:has been|was|is now) (?:marked |successfully )?complete|successfully completed|\bI(?:'ve| have) completed/i);
      break;
    }
    case "Mark everything complete and boxed.": {
      const text = decision.kind === "ask_user" ? decision.question : decision.kind === "complete" ? decision.response : "";
      expect(text).toMatch(/production|complet/i);
      expect(text).toMatch(/box|pack/i);
      expect(text).toMatch(/separate|distinct|which|clarif|specify/i);
      expect(text).not.toMatch(/successfully|I(?:'ve| have) (?:completed|boxed)|everything (?:is|was) (?:complete|boxed)/i);
      break;
    }
  }
  if (!live) expect(script).toHaveLength(0);
}

describe("M4 configured provider intent (no tool execution)", () => {
  test.each(scenarios)("scripted transport: $goal", scenario => checkIntent(scenario, false));
  const isolatedTest = process.env.M4_LIVE_PROVIDER_INTENT === "1" ? test : test.skip;
  isolatedTest.each(scenarios)("isolated live model: $goal", scenario => checkIntent(scenario, true), 260_000);
});
