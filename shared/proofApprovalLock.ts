export type ProofApprovalPreferences = {
  proofing?: {
    proofApprovalLockEnabled?: boolean;
    policy?: ProofingPolicy;
  };
  proofApprovalLockEnabled?: boolean;
};

export type ProofingPolicy = "automatic" | "manual_requested_only";

export type ProofApprovalRequirementResult = {
  requiresProofApproval: boolean;
  productRequiresProofApproval: boolean;
  proofApprovalLockEnabled: boolean;
  manualOverride: boolean;
};

export type ProofApprovalOverrideAuditEntityType = "quote_line_item" | "order_line_item";

export type ProofApprovalOverrideAuditEvent = {
  actionType: "PROOF_APPROVAL_MANUAL_OVERRIDE";
  entityType: ProofApprovalOverrideAuditEntityType;
  entityId: string;
  entityName?: string | null;
  description: string;
  oldValues: {
    requiresProofApproval: true;
    source: "product_default";
  };
  newValues: {
    requiresProofApproval: false;
    source: "manual_override";
    productRequiresProofApproval: true;
    proofApprovalLockEnabled: false;
  };
};

export function resolveProofApprovalLockEnabledFromOrgPreferences(preferences: unknown): boolean {
  const record = preferences && typeof preferences === "object" && !Array.isArray(preferences)
    ? preferences as ProofApprovalPreferences
    : {};
  return record.proofing?.proofApprovalLockEnabled === true || record.proofApprovalLockEnabled === true;
}

/** Defaults to automatic so existing tenants retain their current product-driven behavior. */
export function resolveProofingPolicyFromOrgPreferences(preferences: unknown): ProofingPolicy {
  const record = preferences && typeof preferences === "object" && !Array.isArray(preferences)
    ? preferences as ProofApprovalPreferences
    : {};
  return record.proofing?.policy === "manual_requested_only" ? "manual_requested_only" : "automatic";
}

export function resolveLineItemProofApprovalRequirement(input: {
  productRequiresProofApproval: boolean;
  requestedRequiresProofApproval?: unknown;
  proofApprovalLockEnabled?: boolean;
  proofingPolicy?: ProofingPolicy;
  customerRequiresProofApproval?: boolean;
}): ProofApprovalRequirementResult {
  const productRequiresProofApproval = input.productRequiresProofApproval === true;
  const proofApprovalLockEnabled = input.proofApprovalLockEnabled === true;
  const hasRequestedValue = typeof input.requestedRequiresProofApproval === "boolean";

  // A true value beyond a product that does not require proofs is an explicit
  // staff request. Product-default true values are commonly sent by older
  // clients, so they remain product-derived unless the customer requires proof.
  const explicitManualRequirement = input.requestedRequiresProofApproval === true && !productRequiresProofApproval;
  if (explicitManualRequirement || input.customerRequiresProofApproval === true) {
    return {
      requiresProofApproval: true,
      productRequiresProofApproval,
      proofApprovalLockEnabled,
      manualOverride: false,
    };
  }

  if (input.proofingPolicy === "manual_requested_only") {
    return {
      requiresProofApproval: false,
      productRequiresProofApproval,
      proofApprovalLockEnabled,
      manualOverride: false,
    };
  }

  if (!hasRequestedValue) {
    return {
      requiresProofApproval: productRequiresProofApproval,
      productRequiresProofApproval,
      proofApprovalLockEnabled,
      manualOverride: false,
    };
  }

  if (proofApprovalLockEnabled && productRequiresProofApproval) {
    return {
      requiresProofApproval: true,
      productRequiresProofApproval,
      proofApprovalLockEnabled,
      manualOverride: false,
    };
  }

  const requiresProofApproval = input.requestedRequiresProofApproval === true;
  return {
    requiresProofApproval,
    productRequiresProofApproval,
    proofApprovalLockEnabled,
    manualOverride: productRequiresProofApproval && requiresProofApproval === false,
  };
}

export function buildProofApprovalManualOverrideAuditEvent(input: {
  entityType: ProofApprovalOverrideAuditEntityType;
  entityId: string;
  entityName?: string | null;
}): ProofApprovalOverrideAuditEvent {
  return {
    actionType: "PROOF_APPROVAL_MANUAL_OVERRIDE",
    entityType: input.entityType,
    entityId: input.entityId,
    entityName: input.entityName ?? null,
    description: "Proof approval requirement manually disabled despite product default requiring proof approval.",
    oldValues: {
      requiresProofApproval: true,
      source: "product_default",
    },
    newValues: {
      requiresProofApproval: false,
      source: "manual_override",
      productRequiresProofApproval: true,
      proofApprovalLockEnabled: false,
    },
  };
}
