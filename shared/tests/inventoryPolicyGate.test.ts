import { describe, expect, test } from "@jest/globals";
import {
  DEFAULT_INVENTORY_POLICY,
  getInventoryReservationsGate,
  INVENTORY_RESERVATIONS_DISABLED_MESSAGE,
  resolveInventoryPolicyFromOrgPreferences,
} from "../inventoryPolicy";
import type { InventoryPolicy } from "../inventoryPolicy";

describe("inventoryPolicy gate", () => {
  test("disabled => 409 with stable message", () => {
    const policy: InventoryPolicy = { ...DEFAULT_INVENTORY_POLICY, mode: "off" };
    const gate = getInventoryReservationsGate(policy);

    expect(gate.allowed).toBe(false);
    if (gate.allowed) throw new Error("expected disabled gate");
    expect(gate.status).toBe(409);
    expect(gate.body).toEqual({ success: false, message: INVENTORY_RESERVATIONS_DISABLED_MESSAGE });
  });

  test("enabled => allowed", () => {
    const policy: InventoryPolicy = { ...DEFAULT_INVENTORY_POLICY, mode: "advisory" };
    const gate = getInventoryReservationsGate(policy);
    expect(gate).toEqual({ allowed: true });
  });
});

describe("inventoryPolicy canonicalization", () => {
  test("enabled=false => mode off", () => {
    const policy = resolveInventoryPolicyFromOrgPreferences({
      inventoryPolicy: { enabled: false, mode: "enforced" },
    });
    expect(policy.mode).toBe("off");
  });

  test("enabled=true with missing mode => mode advisory", () => {
    const policy = resolveInventoryPolicyFromOrgPreferences({
      inventoryPolicy: { enabled: true },
    });
    expect(policy.mode).toBe("advisory");
  });

  test("enforcementMode warn_only => mode advisory", () => {
    const policy = resolveInventoryPolicyFromOrgPreferences({
      inventoryPolicy: { enforcementMode: "warn_only" },
    });
    expect(policy.mode).toBe("advisory");
  });

  test("enforcementMode block_on_shortage => mode enforced", () => {
    const policy = resolveInventoryPolicyFromOrgPreferences({
      inventoryPolicy: { enforcementMode: "block_on_shortage" },
    });
    expect(policy.mode).toBe("enforced");
  });

  test("mode=off blocks; advisory/enforced allow", () => {
    expect(getInventoryReservationsGate({ ...DEFAULT_INVENTORY_POLICY, mode: "off" } as InventoryPolicy)).toEqual({
      allowed: false,
      status: 409,
      body: { success: false, message: INVENTORY_RESERVATIONS_DISABLED_MESSAGE },
    });

    expect(getInventoryReservationsGate({ ...DEFAULT_INVENTORY_POLICY, mode: "advisory" } as InventoryPolicy)).toEqual({ allowed: true });
    expect(getInventoryReservationsGate({ ...DEFAULT_INVENTORY_POLICY, mode: "enforced" } as InventoryPolicy)).toEqual({ allowed: true });
  });
});
