import { describe, expect, test } from "@jest/globals";

process.env.DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/isolated_test";
process.env.TEST_DATABASE_URL = " ";

const source = "Aurora Jet Ink. It comes in Teal, Ochre and Violet. It costs $142 per liter and I get it from Aurora Supply.";
const colors = ["Teal", "Ochre", "Violet"];
function field(value: string, start = source.indexOf(value)) { return { value, span: { start, end: start + value.length } }; }
const candidate = {
  familyName: field("Aurora Jet Ink"),
  dimension: { key: "color", displayName: { value: "Color", span: { start: source.indexOf("comes in"), end: source.indexOf("Violet") + "Violet".length } } },
  colors: colors.map((color) => field(color)), supplier: field("Aurora Supply"),
  price: { amount: 142, unit: "liter", span: { start: source.indexOf("$142"), end: source.indexOf("liter") + "liter".length } }, sku: null,
};

describe("source-backed Material pending review", () => {
  async function model() { return import("../services/assistant/materialPendingReview"); }
  async function start() {
    const { startMaterialPendingReview } = await model();
    const review = startMaterialPendingReview({ candidate, sourceMessage: source, question: "Confirm?", taskId: "task_1", conversationId: "conv_1", correlationId: "corr_1" });
    if (!review) throw new Error("Expected a verified review");
    return review;
  }

  test("accepts source-backed typed partial and rejects unsourced or mismatched claims", async () => {
    const { validateMaterialPartialCandidate, readMaterialPendingReview, MATERIAL_REVIEW_KEY } = await model();
    const review = await start();
    expect(readMaterialPendingReview({ [MATERIAL_REVIEW_KEY]: review }, "conv_1", "task_1")).toEqual(review);
    expect(readMaterialPendingReview({ [MATERIAL_REVIEW_KEY]: review }, "conv_2", "task_1")).toBeNull();
    expect(readMaterialPendingReview({ [MATERIAL_REVIEW_KEY]: { ...review, candidate: { ...candidate, price: { ...candidate.price, amount: 143 } } } }, "conv_1", "task_1")).toBeNull();
    expect(validateMaterialPartialCandidate({ ...candidate, colors: [...candidate.colors, field("Orange", 25)] }, source)).toBeNull();
    expect(validateMaterialPartialCandidate({ ...candidate, colors: candidate.colors.slice(0, 2) }, source)).toBeNull();
    expect(validateMaterialPartialCandidate({ ...candidate, sku: "invented" }, source)).toBeNull();
    expect(validateMaterialPartialCandidate({ ...candidate, price: { ...candidate.price, unit: "gallon" } }, source)).toBeNull();
  });

  test.each(["yes", "yep", "correct", "that's right", "go ahead", "do it", "yes that's correct", "yes, that's correct"])("%s only requests explicit SKUs", async (answer) => {
    const { handleMaterialReply } = await model();
    const outcome = handleMaterialReply(await start(), answer);
    expect(outcome.kind).toBe("awaiting");
    if (outcome.kind !== "awaiting") throw new Error("Expected SKU request");
    expect(outcome.review.status).toBe("awaiting_skus");
    expect(outcome.review.version).toBe(2);
    expect(outcome.review.questionId).not.toBe((await start()).questionId);
    expect(outcome.response).toContain("Color: SKU");
    expect(outcome.response).not.toContain("GO");
  });

  test("corrections replace only scoped facts and demand a fresh confirmation", async () => {
    const { handleMaterialReply, readMaterialPendingReview, MATERIAL_REVIEW_KEY } = await model();
    const review = await start();
    const removed = handleMaterialReply(review, "yes but remove Violet");
    expect(removed.kind).toBe("awaiting");
    if (removed.kind !== "awaiting") throw new Error("Expected reconfirmation");
    expect(removed.review.candidate.colors.map((color) => color.value)).toEqual(["Teal", "Ochre"]);
    expect(removed.review.status).toBe("awaiting_confirmation");
    expect(removed.review.questionId).not.toBe(review.questionId);
    expect(readMaterialPendingReview({ [MATERIAL_REVIEW_KEY]: removed.review }, "conv_1", "task_1")).toEqual(removed.review);
    const repriced = handleMaterialReply(removed.review, "$149 per liter instead");
    expect(repriced.kind).toBe("awaiting");
    if (repriced.kind !== "awaiting") throw new Error("Expected price reconfirmation");
    expect(repriced.review.candidate.price.amount).toBe(149);
    expect(readMaterialPendingReview({ [MATERIAL_REVIEW_KEY]: repriced.review }, "conv_1", "task_1")).toEqual(repriced.review);
    const reworded = handleMaterialReply(removed.review, "make it $149 per liter instead");
    expect(reworded.kind).toBe("awaiting");
    if (reworded.kind !== "awaiting") throw new Error("Expected reworded price reconfirmation");
    expect(reworded.review.candidate.price.amount).toBe(149);
    expect(readMaterialPendingReview({ [MATERIAL_REVIEW_KEY]: reworded.review }, "conv_1", "task_1")).toEqual(reworded.review);
    expect(handleMaterialReply(review, "yes but remove Orange").kind).toBe("invalid");
    expect(handleMaterialReply(review, "no").kind).toBe("cancelled");
  });

  test("only one explicit SKU per color builds a governed family action", async () => {
    const { handleMaterialReply } = await model();
    const confirmed = handleMaterialReply(await start(), "yes");
    if (confirmed.kind !== "awaiting") throw new Error("Expected SKU request");
    expect(handleMaterialReply(confirmed.review, "Teal: TEAL-1\nOrange: BAD").kind).toBe("invalid");
    expect(handleMaterialReply(confirmed.review, "Teal: INK-A\nOchre: ink-a").kind).toBe("invalid");
    const partial = handleMaterialReply(confirmed.review, "Teal: TEAL-1");
    if (partial.kind !== "awaiting") throw new Error("Expected remaining SKU request");
    expect(partial.response).toContain("Ochre, Violet");
    const complete = handleMaterialReply(partial.review, "Ochre: OCHRE-2\nViolet: VIOLET-3");
    expect(complete.kind).toBe("ready");
    if (complete.kind !== "ready" || complete.action.action !== "materials.create_family") throw new Error("Expected governed family action");
    expect(complete.action.variants).toHaveLength(3);
    expect(complete.action.variants.map((variant) => variant.material.sku)).toEqual(["TEAL-1", "OCHRE-2", "VIOLET-3"]);
    expect(complete.action.variants[0]?.material).toMatchObject({ materialForm: "liquid", inventoryUnit: "milliliter", consumptionUnit: "milliliter", purchaseUnit: "liter", costPerPurchaseUnit: 142, preferredVendorName: "Aurora Supply" });
    const { assistantMaterialActionService } = await import("../services/assistant/materialActionService");
    expect(assistantMaterialActionService.normalizeMaterial(complete.action.variants[0]!.material)).toMatchObject({ type: "liquid", materialForm: "liquid", inventoryUnit: "milliliter", consumptionUnit: "milliliter", vendorCostPerUnit: 142, costPerUnit: 0.142 });
    expect(handleMaterialReply(confirmed.review, "yes").kind).toBe("invalid");
  });

  test("operator refuses a prose-only Material confirmation and accepts a sourced partial", async () => {
    const { AssistantOperatorRuntime } = await import("../services/assistant/operatorRuntime");
    const makeRuntime = (materialCandidate?: typeof candidate) => new AssistantOperatorRuntime({ decide: async () => ({ kind: "ask_user", question: "Confirm the family?", missingInformation: ["confirmation"], ...(materialCandidate ? { materialCandidate } : {}) }) }, { catalog: () => [], execute: async () => ({ toolName: "unexpected", status: "rejected" }) });
    const trustedContext = { scope: { organizationId: "org_1", userId: "user_1" }, conversationId: "conv_1", actor: { userId: "user_1", email: null }, permissions: [], context: { contextVersion: "v1" as const, route: "/assistant", pageTitle: "Assistant" }, correlationId: "corr_1", goal: source, task: { id: "task_1", domain: "materials", canonicalProductIntentProposalId: null, entityReferences: [], missingInformation: ["material details"] } };
    const input = { goal: source, taskId: "task_1", trustedContext };
    expect((await makeRuntime().run(input)).status).toBe("failed");
    const result = await makeRuntime(candidate).run(input);
    expect(result.status).toBe("awaiting_input");
    expect(result.materialCandidate).toMatchObject(candidate);
    expect(result.observations).toHaveLength(0);
  });
});
