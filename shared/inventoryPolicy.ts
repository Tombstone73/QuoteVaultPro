export type InventoryPolicyMode = "off" | "advisory" | "enforced";

export type InventoryPolicy = {
  mode: InventoryPolicyMode;
  autoReserveOnApplyPbV2: boolean;
  autoReserveOnOrderConfirm: boolean;
  allowNegative: boolean;
};

export const DEFAULT_INVENTORY_POLICY: InventoryPolicy = {
  mode: "off",
  autoReserveOnApplyPbV2: false,
  autoReserveOnOrderConfirm: false,
  allowNegative: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parsePolicyMode(value: unknown): InventoryPolicyMode | undefined {
  if (value === "off" || value === "advisory" || value === "enforced") return value;
  return undefined;
}

function parseLegacyEnforcementMode(value: unknown): InventoryPolicyMode | undefined {
  if (value === "warn_only") return "advisory";
  if (value === "block_on_shortage") return "enforced";
  if (value === "off") return "off";
  return undefined;
}

/**
 * Resolve the org-scoped inventory policy from `organizations.settings.preferences`.
 * Safe defaults are OFF.
 */
export function resolveInventoryPolicyFromOrgPreferences(preferences: unknown): InventoryPolicy {
  if (!isRecord(preferences)) return { ...DEFAULT_INVENTORY_POLICY };

  // Allow a couple of names to reduce brittleness while we iterate.
  const raw = (preferences.inventoryPolicy ?? preferences.inventoryReservations ?? preferences.inventory) as unknown;
  if (!isRecord(raw)) return { ...DEFAULT_INVENTORY_POLICY };

  // Canonical mode (preferred)
  let mode: InventoryPolicyMode = parsePolicyMode(raw.mode) ?? "off";

  // Legacy booleans (enabled/reservationsEnabled). If explicitly false, it must be off.
  const legacyEnabled =
    typeof raw.enabled === "boolean"
      ? raw.enabled
      : typeof raw.reservationsEnabled === "boolean"
        ? raw.reservationsEnabled
        : undefined;
  if (legacyEnabled === false) {
    mode = "off";
  } else if (legacyEnabled === true && raw.mode === undefined) {
    // enabled=true with missing mode => advisory (safe default)
    mode = "advisory";
  }

  // Legacy enforcementMode maps deterministically if mode is not explicitly present.
  if (raw.mode === undefined) {
    const mapped = parseLegacyEnforcementMode(raw.enforcementMode);
    if (mapped) mode = mapped;
  }

  return {
    mode,
    autoReserveOnApplyPbV2: Boolean(raw.autoReserveOnApplyPbV2),
    autoReserveOnOrderConfirm: Boolean(raw.autoReserveOnOrderConfirm),
    allowNegative: Boolean(raw.allowNegative),
  };
}

export type InventoryReservationsGate =
  | { allowed: true }
  | { allowed: false; status: 409; body: { success: false; message: string } };

export const INVENTORY_RESERVATIONS_DISABLED_MESSAGE = "Inventory reservations are disabled for this organization.";

/**
 * Pure gating helper for endpoints/UI.
 * When disabled, endpoints must return 409 with a stable message.
 */
export function getInventoryReservationsGate(policy: InventoryPolicy): InventoryReservationsGate {
  if (policy.mode === "off") {
    return {
      allowed: false,
      status: 409,
      body: { success: false, message: INVENTORY_RESERVATIONS_DISABLED_MESSAGE },
    };
  }
  return { allowed: true };
}
