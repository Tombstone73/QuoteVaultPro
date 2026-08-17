import { describe, expect, test } from "@jest/globals";
import { classifyLegacyOrder } from "../../infrastructure/sales/postgresSalesWorkspaceReads.js";

const row = (patch: Partial<Parameters<typeof classifyLegacyOrder>[0]> = {}) => ({
  status: "new", state: "open", canonical_state: null, fulfillment_status: "pending", payment_status: "unpaid", production_open: "0", balance_due_cents: "0", ...patch,
});

describe("M5.2 legacy commercial compatibility classification", () => {
  test("keeps closed legacy history read-only", () => expect(classifyLegacyOrder(row({ status: "canceled", state: "canceled" }))).toBe("CLOSED_HISTORY"));
  test("flags work in production for a deliberate cutover strategy", () => expect(classifyLegacyOrder(row({ status: "in_production", production_open: "1" }))).toBe("ACTIVE_REQUIRES_CUTOVER_STRATEGY"));
  test("permits a simple new unpaid order to remain legacy pending review", () => expect(classifyLegacyOrder(row())).toBe("ACTIVE_BUT_CAN_REMAIN_LEGACY"));
  test("fails safe for unrecognized state combinations", () => expect(classifyLegacyOrder(row({ status: "mystery", state: "mystery" }))).toBe("AMBIGUOUS"));
});
