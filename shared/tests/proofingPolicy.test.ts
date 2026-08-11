import {
  resolveLineItemProofApprovalRequirement,
  resolveProofingPolicyFromOrgPreferences,
} from "../proofApprovalLock";

describe("organization proofing policy", () => {
  test("defaults existing tenants to automatic proofing", () => {
    expect(resolveProofingPolicyFromOrgPreferences({})).toBe("automatic");
  });

  test("honors product proof requirements in automatic mode", () => {
    expect(resolveLineItemProofApprovalRequirement({
      productRequiresProofApproval: true,
      proofingPolicy: "automatic",
    }).requiresProofApproval).toBe(true);
  });

  test("suspends product proof requirements in manual requested mode", () => {
    expect(resolveLineItemProofApprovalRequirement({
      productRequiresProofApproval: true,
      proofingPolicy: "manual_requested_only",
    }).requiresProofApproval).toBe(false);
  });

  test("keeps customer and explicit manual requirements effective in manual mode", () => {
    expect(resolveLineItemProofApprovalRequirement({
      productRequiresProofApproval: true,
      customerRequiresProofApproval: true,
      proofingPolicy: "manual_requested_only",
    }).requiresProofApproval).toBe(true);
    expect(resolveLineItemProofApprovalRequirement({
      productRequiresProofApproval: false,
      requestedRequiresProofApproval: true,
      proofingPolicy: "manual_requested_only",
    }).requiresProofApproval).toBe(true);
  });

  test("switching policies reactivates the unchanged product rule", () => {
    const product = { productRequiresProofApproval: true };
    expect(resolveLineItemProofApprovalRequirement({ ...product, proofingPolicy: "manual_requested_only" }).requiresProofApproval).toBe(false);
    expect(resolveLineItemProofApprovalRequirement({ ...product, proofingPolicy: "automatic" }).requiresProofApproval).toBe(true);
  });
});
