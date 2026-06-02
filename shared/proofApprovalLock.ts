export type ProofApprovalPreferences = {
  proofing?: {
    proofApprovalLockEnabled?: boolean;
  };
  proofApprovalLockEnabled?: boolean;
};

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

export function resolveLineItemProofApprovalRequirement(input: {
  productRequiresProofApproval: boolean;
  requestedRequiresProofApproval?: unknown;
  proofApprovalLockEnabled?: boolean;
}): ProofApprovalRequirementResult {
  const productRequiresProofApproval = input.productRequiresProofApproval === true;
  const proofApprovalLockEnabled = input.proofApprovalLockEnabled === true;
  const hasRequestedValue = typeof input.requestedRequiresProofApproval === "boolean";

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
