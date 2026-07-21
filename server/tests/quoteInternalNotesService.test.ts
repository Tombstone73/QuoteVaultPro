import { describe, expect, jest, test } from "@jest/globals";
import { QuoteInternalNotesService } from "../services/quoteInternalNotesService";

const note = {
  id: "note_1",
  organizationId: "org_1",
  quoteId: "quote_1",
  noteText: "Call before production.",
  createdByUserId: "user_1",
  createdAt: new Date("2026-07-21T12:00:00.000Z"),
};

function store(overrides: Record<string, unknown> = {}) {
  return {
    getQuoteOwnership: jest.fn(async (organizationId: string, quoteId: string) => organizationId === "org_1" && quoteId === "quote_1" ? { quoteId } : null),
    resolveReference: jest.fn(async (organizationId: string, reference: { quoteId?: string; expectedQuoteNumber?: string }) => {
      if (organizationId !== "org_1" || (reference.quoteId !== "quote_1" && reference.expectedQuoteNumber !== "1042")) return null;
      return { id: "quote_1", displayNumber: "Q-1042", quoteNumber: 1042, customerName: "Acme" };
    }),
    list: jest.fn(async () => [{ ...note, createdByUserName: "staff@example.test" }]),
    append: jest.fn(async (_org: string, _quote: string, _user: string | null, values: { noteText: string }) => ({ ...note, noteText: values.noteText })),
    ...overrides,
  };
}

describe("QuoteInternalNotesService", () => {
  test("appends a normalized note only after tenant-scoped quote ownership succeeds", async () => {
    const repository = store();
    const service = new QuoteInternalNotesService(repository as any);
    await expect(service.append({ organizationId: "org_1", quoteId: "quote_1", userId: "user_1", values: { noteText: "  Call before production.  " } })).resolves.toMatchObject({ noteText: "Call before production." });
    expect(repository.append).toHaveBeenCalledWith("org_1", "quote_1", "user_1", { noteText: "Call before production." }, undefined);
  });

  test("does not disclose or append a cross-tenant quote", async () => {
    const repository = store();
    const service = new QuoteInternalNotesService(repository as any);
    await expect(service.list({ organizationId: "org_other", quoteId: "quote_1" })).resolves.toBeNull();
    await expect(service.append({ organizationId: "org_other", quoteId: "quote_1", userId: "user_other", values: { noteText: "Hidden" } })).resolves.toBeNull();
    expect(repository.list).not.toHaveBeenCalled();
    expect(repository.append).not.toHaveBeenCalled();
  });

  test("rejects empty or overlong text before storage", async () => {
    const repository = store();
    const service = new QuoteInternalNotesService(repository as any);
    await expect(service.append({ organizationId: "org_1", quoteId: "quote_1", userId: "user_1", values: { noteText: "   " } })).rejects.toThrow();
    expect(repository.getQuoteOwnership).not.toHaveBeenCalled();
  });

  test("returns only a reduced tenant-scoped reference with a stable fingerprint", async () => {
    const service = new QuoteInternalNotesService(store() as any);
    const resolved = await service.resolveQuoteReference({ organizationId: "org_1", expectedQuoteNumber: "1042" });
    expect(resolved).toEqual(expect.objectContaining({ id: "quote_1", displayNumber: "Q-1042", customerName: "Acme", fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(Object.keys(resolved ?? {}).sort()).toEqual(["customerName", "displayNumber", "fingerprint", "id", "quoteNumber"]);
  });

  test("creates one internal-only assistant note with an audit link and reuses it for the same plan", async () => {
    const created = { ...note, source: "assistant", assistantPlanId: "plan_1", domainAuditId: "audit_1" };
    const repository = store({
      findByAssistantPlan: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(created),
      append: jest.fn(async () => created),
    });
    const audit = { createAuditLog: jest.fn(async () => ({ id: "audit_1" })) };
    const service = new QuoteInternalNotesService(repository as any, audit as any);
    const args = {
      organizationId: "org_1", actorUserId: "user_1", quoteId: "quote_1",
      noteText: "  Artwork arrives tomorrow.  ", assistantPlanId: "plan_1",
      idempotencyKey: "aicmd_123e4567-e89b-12d3-a456-426614174000", correlationId: "corr_1",
    };

    await expect(service.addInternalNote(args)).resolves.toMatchObject({
      note: { id: "note_1", classification: "internal_only" }, domainAuditReference: "audit_1",
    });
    await expect(service.addInternalNote(args)).resolves.toMatchObject({
      note: { id: "note_1", classification: "internal_only" }, domainAuditReference: "audit_1",
    });
    expect(audit.createAuditLog).toHaveBeenCalledTimes(1);
    expect(repository.append).toHaveBeenCalledTimes(1);
    expect(repository.append).toHaveBeenCalledWith("org_1", "quote_1", "user_1", expect.objectContaining({
      noteText: "Artwork arrives tomorrow.", source: "assistant", assistantPlanId: "plan_1", domainAuditId: "audit_1",
    }));
  });
});
