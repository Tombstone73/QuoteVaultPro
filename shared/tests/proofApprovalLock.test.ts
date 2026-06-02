import { describe, expect, test } from "@jest/globals";

import {
  buildProofApprovalManualOverrideAuditEvent,
  resolveLineItemProofApprovalRequirement,
  resolveProofApprovalLockEnabledFromOrgPreferences,
} from "../proofApprovalLock";

describe("proof approval lock policy", () => {
  test("defaults to unlocked and allows product-required proof approval to be unchecked", () => {
    expect(resolveProofApprovalLockEnabledFromOrgPreferences({})).toBe(false);

    const result = resolveLineItemProofApprovalRequirement({
      productRequiresProofApproval: true,
      requestedRequiresProofApproval: false,
    });

    expect(result.requiresProofApproval).toBe(false);
    expect(result.manualOverride).toBe(true);
  });

  test("keeps product-required proof approval checked when lock preference is enabled", () => {
    const result = resolveLineItemProofApprovalRequirement({
      productRequiresProofApproval: true,
      requestedRequiresProofApproval: false,
      proofApprovalLockEnabled: true,
    });

    expect(result.requiresProofApproval).toBe(true);
    expect(result.manualOverride).toBe(false);
  });

  test("persists a manual unchecked state when the organization is unlocked", () => {
    const result = resolveLineItemProofApprovalRequirement({
      productRequiresProofApproval: true,
      requestedRequiresProofApproval: false,
      proofApprovalLockEnabled: false,
    });

    expect(result.requiresProofApproval).toBe(false);
  });

  test("builds a clear audit event when required proof is manually disabled", () => {
    const event = buildProofApprovalManualOverrideAuditEvent({
      entityType: "order_line_item",
      entityId: "line-1",
      entityName: "Banner",
    });

    expect(event.actionType).toBe("PROOF_APPROVAL_MANUAL_OVERRIDE");
    expect(event.entityType).toBe("order_line_item");
    expect(event.entityId).toBe("line-1");
    expect(event.description).toContain("manually disabled");
    expect(event.oldValues.requiresProofApproval).toBe(true);
    expect(event.newValues.requiresProofApproval).toBe(false);
    expect(event.newValues.source).toBe("manual_override");
  });
});
