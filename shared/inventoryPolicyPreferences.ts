import { DEFAULT_INVENTORY_POLICY, resolveInventoryPolicyFromOrgPreferences } from "./inventoryPolicy";

export type InventoryPolicyUiMode = "off" | "advisory" | "enforced";

export type InventoryPolicyPatchInput = {
  enabled?: boolean;
  reservationsEnabled?: boolean;

  mode?: InventoryPolicyUiMode;
  enforcementMode?: "off" | "warn_only" | "block_on_shortage";

  autoReserveOnApplyPbV2?: boolean;
  autoReserveOnOrderConfirm?: boolean;

  // Future-proofing: accepted and persisted, but not currently enforced.
  allowNegative?: boolean;
};

export type NormalizeInventoryPolicyPatchResult = {
  patch: {
    mode: InventoryPolicyUiMode;
    autoReserveOnApplyPbV2?: boolean;
    autoReserveOnOrderConfirm?: boolean;
    allowNegative?: boolean;
  };
  warnings: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mapUiModeToEnforcementMode(
  mode: InventoryPolicyUiMode,
): "off" | "warn_only" | "block_on_shortage" {
  switch (mode) {
    case "advisory":
      return "warn_only";
    case "enforced":
      return "block_on_shortage";
    case "off":
    default:
      return "off";
  }
}

function mapUiModeToCanonicalMode(mode: InventoryPolicyUiMode): "off" | "advisory" | "enforced" {
  if (mode === "advisory") return "advisory";
  if (mode === "enforced") return "enforced";
  return "off";
}

function mapLegacyEnforcementToCanonicalMode(
  mode: "off" | "warn_only" | "block_on_shortage",
): "off" | "advisory" | "enforced" {
  if (mode === "warn_only") return "advisory";
  if (mode === "block_on_shortage") return "enforced";
  return "off";
}

/**
 * Normalize a mixed legacy/canonical patch to a canonical, mode-first patch.
 *
 * Rules:
 * - If `mode` is present, it wins.
 * - Else, derive mode from legacy fields using the existing canonicalizer.
 * - Emits warnings for deprecated legacy fields if they are supplied.
 */
export function normalizeInventoryPolicyPatch(patch: InventoryPolicyPatchInput): NormalizeInventoryPolicyPatchResult {
  const warnings: string[] = [];

  const legacyFields: Array<keyof InventoryPolicyPatchInput> = [
    "enabled",
    "reservationsEnabled",
    "enforcementMode",
  ];

  for (const field of legacyFields) {
    if (patch[field] !== undefined) {
      warnings.push(`Legacy field '${String(field)}' is deprecated; use 'mode' instead.`);
    }
  }

  const canonicalMode: InventoryPolicyUiMode = patch.mode
    ? patch.mode
    : (resolveInventoryPolicyFromOrgPreferences({ inventoryPolicy: patch }).mode as InventoryPolicyUiMode);

  return {
    patch: {
      mode: canonicalMode,
      ...(typeof patch.autoReserveOnApplyPbV2 === "boolean" ? { autoReserveOnApplyPbV2: patch.autoReserveOnApplyPbV2 } : {}),
      ...(typeof patch.autoReserveOnOrderConfirm === "boolean" ? { autoReserveOnOrderConfirm: patch.autoReserveOnOrderConfirm } : {}),
      ...(typeof patch.allowNegative === "boolean" ? { allowNegative: patch.allowNegative } : {}),
    },
    warnings,
  };
}

/**
 * Merge an inventory policy patch into an existing org preferences object.
 *
 * - Never clobbers unrelated preference keys.
 * - Always writes to `preferences.inventoryPolicy`.
 * - Applies safe defaults via `resolveInventoryPolicyFromOrgPreferences`.
 */
export function mergeInventoryPolicyIntoPreferences(
  existingPreferences: unknown,
  patch: InventoryPolicyPatchInput,
): Record<string, unknown> {
  const basePreferences = isRecord(existingPreferences) ? existingPreferences : {};

  const basePolicy = resolveInventoryPolicyFromOrgPreferences(basePreferences);
  const nextPolicy = {
    ...DEFAULT_INVENTORY_POLICY,
    ...basePolicy,
  } as any;

  const enabled = patch.enabled ?? patch.reservationsEnabled ?? undefined;

  if (typeof patch.autoReserveOnApplyPbV2 === "boolean") {
    nextPolicy.autoReserveOnApplyPbV2 = patch.autoReserveOnApplyPbV2;
  }

  if (typeof patch.autoReserveOnOrderConfirm === "boolean") {
    nextPolicy.autoReserveOnOrderConfirm = patch.autoReserveOnOrderConfirm;
  }

  if (typeof patch.allowNegative === "boolean") {
    nextPolicy.allowNegative = patch.allowNegative;
  }

  if (patch.mode) {
    nextPolicy.mode = mapUiModeToCanonicalMode(patch.mode);
  } else if (patch.enforcementMode) {
    // Back-compat input support
    nextPolicy.mode = mapLegacyEnforcementToCanonicalMode(patch.enforcementMode);
  } else if (typeof enabled === "boolean") {
    // enabled=false -> off; enabled=true without mode -> advisory (if current is off)
    if (!enabled) {
      nextPolicy.mode = "off";
    } else if (nextPolicy.mode === "off") {
      nextPolicy.mode = "advisory";
    }
  }

  // enabled=false is always equivalent to mode=off
  if (enabled === false) {
    nextPolicy.mode = "off";
  }

  return {
    ...basePreferences,
    inventoryPolicy: nextPolicy,
  };
}
