import {
  deriveLineItemProofSummary,
  deriveOrderProofSummary,
} from "@shared/orderProofStatus";

describe("order proof status derivation", () => {
  it("returns no proof required when no line items need proof", () => {
    const summary = deriveOrderProofSummary([
      deriveLineItemProofSummary({
        lineItemId: "line-1",
        requiresProofApproval: false,
      }),
    ]);

    expect(summary.proofStatus).toBe("no_proof_required");
    expect(summary.proofCounts.required).toBe(0);
    expect(summary.proofLineItemId).toBeNull();
  });

  it("prioritizes proof needed before draft not sent and awaiting approval", () => {
    const summary = deriveOrderProofSummary([
      deriveLineItemProofSummary({
        lineItemId: "line-awaiting",
        requiresProofApproval: true,
        latestProofVersionStatus: "awaiting_response",
        hasAnyProofVersion: true,
        hasSentProofVersion: true,
      }),
      deriveLineItemProofSummary({
        lineItemId: "line-draft",
        requiresProofApproval: true,
        latestProofVersionStatus: "draft",
        hasAnyProofVersion: true,
      }),
      deriveLineItemProofSummary({
        lineItemId: "line-needed",
        requiresProofApproval: true,
        hasAnyProofVersion: false,
      }),
    ]);

    expect(summary.proofStatus).toBe("proof_needed");
    expect(summary.proofLineItemId).toBe("line-needed");
    expect(summary.proofCounts.needed).toBe(1);
    expect(summary.proofCounts.draftNotSent).toBe(1);
    expect(summary.proofCounts.awaitingApproval).toBe(1);
  });

  it("returns proof issue when the latest proof was rejected", () => {
    const rejected = deriveLineItemProofSummary({
      lineItemId: "line-rejected",
      requiresProofApproval: true,
      latestDecision: "revision_requested",
      hasAnyProofVersion: true,
      hasSentProofVersion: true,
    });

    expect(rejected.status).toBe("rejected_or_changes_requested");

    const summary = deriveOrderProofSummary([rejected]);
    expect(summary.proofStatus).toBe("proof_issue");
    expect(summary.proofActionRequired).toBe(true);
    expect(summary.proofLineItemId).toBe("line-rejected");
  });

  it("returns approved when all required proof items are approved", () => {
    const summary = deriveOrderProofSummary([
      deriveLineItemProofSummary({
        lineItemId: "line-approved",
        requiresProofApproval: true,
        approvedProofVersionId: "proof-1",
        approvedNormally: true,
        hasAnyProofVersion: true,
        hasSentProofVersion: true,
      }),
    ]);

    expect(summary.proofStatus).toBe("approved");
    expect(summary.proofCounts.approved).toBe(1);
    expect(summary.proofActionRequired).toBe(false);
  });

  it("treats superseded proofs as needing a new proof instead of awaiting customer approval", () => {
    const lineItem = deriveLineItemProofSummary({
      lineItemId: "line-superseded",
      requiresProofApproval: true,
      latestProofVersionStatus: "superseded",
      hasAnyProofVersion: true,
      hasSentProofVersion: false,
    });

    expect(lineItem.status).toBe("proof_needed");

    const summary = deriveOrderProofSummary([lineItem]);
    expect(summary.proofStatus).toBe("proof_needed");
    expect(summary.proofCounts.awaitingApproval).toBe(0);
  });

  it("treats cancelled proofs as needing a new proof instead of satisfying approval", () => {
    const lineItem = deriveLineItemProofSummary({
      lineItemId: "line-cancelled",
      requiresProofApproval: true,
      latestProofVersionStatus: "cancelled",
      hasAnyProofVersion: true,
      hasSentProofVersion: false,
    });

    expect(lineItem.status).toBe("proof_needed");

    const summary = deriveOrderProofSummary([lineItem]);
    expect(summary.proofStatus).toBe("proof_needed");
    expect(summary.proofCounts.approved).toBe(0);
  });
});
