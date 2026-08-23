import assert from "node:assert/strict";
import { ProductVersionLifecycleApplicationService } from "../../src/modules/products/productVersionLifecycle";

type Created = { productId: string; draftVersionId: string; draftUpdatedAt: string };

class InitialDraftRunner {
  readonly receipts = new Map<string, { fingerprint: string; result: Created }>();
  created = 0;
  inactiveDraft = false;
  failBeforeCommit = false;

  async transaction<T>(action: (tx: any) => Promise<T>): Promise<T> {
    return action({
      reserve: async (input: any) => {
        const prior = this.receipts.get(input.businessRequestId);
        if (prior) {
          if (prior.fingerprint !== input.payloadFingerprint) throw new Error("Idempotency request payload changed.");
          return { kind: "replay", request: { id: input.businessRequestId, resultJson: prior.result } };
        }
        return { kind: "new", request: { id: input.businessRequestId, resultJson: null } };
      },
      createProductWithInitialDraft: async () => {
        if (this.failBeforeCommit) throw new Error("create failed before commit");
        this.created += 1;
        this.inactiveDraft = true;
        return { productId: "product-1", draftVersionId: "draft-1", draftUpdatedAt: "2026-08-23T12:00:00.000Z" };
      },
      attribute: async () => undefined,
      audit: async () => undefined,
      succeed: async (_org: string, requestId: string, _resourceId: string, result: Created) => {
        // The real transaction stores the request fingerprint at reserve. This
        // compact pure runner only needs the exact replay result for the
        // lost-response path below.
        this.receipts.set(requestId, { fingerprint: this.pendingFingerprint.get(requestId)!, result });
      },
    });
  }
  readonly pendingFingerprint = new Map<string, string>();
}

// Preserve the request fingerprint just as the durable PostgreSQL reserve
// record does, without involving a database in this pure test.
const runner = new InitialDraftRunner();
const original = runner.transaction.bind(runner);
runner.transaction = async <T>(action: (tx: any) => Promise<T>) => original(async (tx) => action({
  ...tx,
  reserve: async (input: any) => {
    runner.pendingFingerprint.set(input.businessRequestId, input.payloadFingerprint);
    const prior = runner.receipts.get(input.businessRequestId);
    if (prior) {
      if (prior.fingerprint !== input.payloadFingerprint) throw new Error("Idempotency request payload changed.");
      return { kind: "replay", request: { id: input.businessRequestId, resultJson: prior.result } };
    }
    return { kind: "new", request: { id: input.businessRequestId, resultJson: null } };
  },
}));

const context = (id: string) => ({ organizationId: "org-1", operationId: id, businessRequest: { id, payloadFingerprint: id }, principal: { kind: "staff" as const, organizationId: "org-1", userId: "staff-1", authority: { membershipId: "membership-1", capabilities: ["product.edit"] } } });
const service = new ProductVersionLifecycleApplicationService(runner as any);

// Simulate a committed response that the browser never received, then replay
// the same durable request. Exactly one inactive Product/DRAFT is created.
const first = await service.createProductWithInitialDraft(context("create-1"), { businessRequestId: "create-1", displayName: "New Product" });
assert.equal(first.ok, true);
const replay = await service.createProductWithInitialDraft(context("create-1"), { businessRequestId: "create-1", displayName: "New Product" });
assert.deepEqual(replay, first);
assert.equal(runner.created, 1);
assert.equal(runner.inactiveDraft, true);
const changedPayload = await service.createProductWithInitialDraft(context("create-1"), { businessRequestId: "create-1", displayName: "Different name" });
assert.equal(changedPayload.ok, false);
assert.equal(runner.created, 1);

// A genuine pre-commit failure does not produce an adopted identity.
const failing = new InitialDraftRunner();
failing.failBeforeCommit = true;
const failure = await new ProductVersionLifecycleApplicationService(failing as any).createProductWithInitialDraft(context("create-fail"), { businessRequestId: "create-fail", displayName: "Fails" });
assert.equal(failure.ok, false);
assert.equal(failing.created, 0);
assert.equal(failing.inactiveDraft, false);

console.log("Initial Product/Draft durable-create tests passed.");
