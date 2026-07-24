import { ExecutionPlanError } from "../services/assistant/execution/types";
import { createQuoteDraftCreateExecutionCommand } from "../services/assistant/execution/quoteDraftCreateExecutionCommand";
import { createQuoteDraftUpdateExecutionCommand } from "../services/assistant/execution/quoteDraftUpdateExecutionCommand";

const proposalFingerprint = "a".repeat(64);
const quoteFingerprint = "b".repeat(64);
const scope = { organizationId: "org_1", userId: "user_1", permissions: ["assistant.internal_staff"], environment: "test" };

const createProposal = {
  quoteIntakeSessionId: "session_1",
  proposalFingerprint,
  customerName: "Graphic Solutions",
  contactName: "Rick Clark",
  quoteTitle: "ACM panels",
  lineItems: [{ clientKey: "line_1", productName: "ACM", quantity: 10, dimensions: { width: 48, height: 96, unit: "in" }, parentClientKey: null, lineSubtotalCents: 10000, taxCents: 500, totalCents: 10500 }],
  subtotalCents: 10000,
  taxCents: 500,
  totalCents: 10500,
  validationErrors: [],
  warnings: [],
  affectedQuoteCount: 1 as const,
  downstreamActionsExcluded: ["order_creation", "production_job_creation", "inventory_reservation", "invoice_creation", "email_sending", "quote_acceptance_or_conversion"] as const,
};

const updateProposal = {
  quote: { id: "quote_1", displayNumber: "Q-1042", status: "draft" as const, sourceLink: "/quotes/quote_1" },
  quoteIntakeSessionId: "session_2",
  proposalFingerprint,
  expectedQuoteFingerprint: quoteFingerprint,
  changes: [{ field: "quantity", before: 10, after: 12 }],
  subtotalCentsBefore: 10000,
  subtotalCentsAfter: 12000,
  taxCentsBefore: 500,
  taxCentsAfter: 600,
  totalCentsBefore: 10500,
  totalCentsAfter: 12600,
  validationErrors: [],
  warnings: [],
  affectedQuoteCount: 1 as const,
  downstreamActionsExcluded: ["order_creation", "production_job_creation", "inventory_reservation", "invoice_creation", "email_sending", "quote_acceptance_or_conversion"] as const,
};

describe("draft quote execution command bridges", () => {
  it("creates one preview from a revalidated proposal and keeps all price data server-side", async () => {
    let writes = 0;
    const command = createQuoteDraftCreateExecutionCommand({
      revalidateCreateProposal: async () => ({ valid: true as const, proposal: createProposal }),
      createDraft: async () => {
        writes += 1;
        return { quote: { id: "quote_1", displayNumber: "Q-1042", status: "draft" as const, totalCents: 10500, sourceLink: "/quotes/quote_1" } };
      },
    });
    const built = await command.buildPreview({ scope, context: {} as any, arguments: { quoteIntakeSessionId: "session_1", proposalFingerprint } });
    expect(built.preview.quoteDraftCreate).toMatchObject({ customerName: "Graphic Solutions", totalCents: 10500 });
    expect(built.arguments).not.toHaveProperty("totalCents");

    const result = await command.execute({
      plan: { id: "plan_1", idempotencyKey: "aicmd_123e4567-e89b-12d3-a456-426614174000", correlationId: "corr_1", sanitizedArguments: built.arguments, } as any,
      scope,
    });
    expect(writes).toBe(1);
    expect(result.status).toBe("succeeded");
  });

  it("does not build or execute invalid create proposals", async () => {
    const command = createQuoteDraftCreateExecutionCommand({
      revalidateCreateProposal: async () => ({ valid: false as const, code: "QUOTE_PROPOSAL_STALE", summary: "Reprice required." }),
      createDraft: async () => { throw new Error("must not write"); },
    });
    await expect(command.buildPreview({ scope, context: {} as any, arguments: { quoteIntakeSessionId: "session_1", proposalFingerprint } })).rejects.toEqual(expect.objectContaining<Partial<ExecutionPlanError>>({ code: "QUOTE_PROPOSAL_STALE" }));
  });

  it("binds update plans to both the quote and proposal fingerprints", async () => {
    const command = createQuoteDraftUpdateExecutionCommand({
      revalidateUpdateProposal: async () => ({ valid: true as const, proposal: updateProposal }),
      updateDraft: async () => ({ quote: { id: "quote_1", displayNumber: "Q-1042", status: "draft" as const, totalCents: 12600, sourceLink: "/quotes/quote_1" } }),
    });
    const built = await command.buildPreview({ scope, context: {} as any, arguments: { quoteId: "quote_1", quoteIntakeSessionId: "session_2", proposalFingerprint, expectedQuoteFingerprint: quoteFingerprint } });
    expect(built.preview.quoteDraftUpdate).toMatchObject({ quoteId: "quote_1", totalCentsAfter: 12600 });
    const revalidation = await command.revalidate({ plan: { sanitizedArguments: built.arguments, affectedRecords: built.preview.affectedRecords } as any, scope });
    expect(revalidation).toEqual({ valid: true });
  });
});
