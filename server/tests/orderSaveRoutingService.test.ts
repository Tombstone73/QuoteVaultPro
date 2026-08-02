import { normalizeOrderSaveRoutingMode, resolveOrderSaveRouteTarget } from "@shared/orderSaveRouting";

describe("order save routing policy", () => {
  it("keeps save-only as the safe default", () => {
    expect(normalizeOrderSaveRoutingMode(undefined)).toBe("save_only");
    expect(normalizeOrderSaveRoutingMode("unexpected")).toBe("save_only");
  });

  it("uses Design, then Proofing, then Prepress precedence", () => {
    expect(resolveOrderSaveRouteTarget({ requiresDesign: true, requiresProofApproval: true, requiresPrepress: true }))
      .toEqual({ state: "needs_design", destination: "Design" });
    expect(resolveOrderSaveRouteTarget({ requiresDesign: false, requiresProofApproval: true, requiresPrepress: true }))
      .toEqual({ state: "awaiting_proof_approval", destination: "Proofing" });
    expect(resolveOrderSaveRouteTarget({ requiresDesign: false, requiresProofApproval: false, requiresPrepress: true }))
      .toEqual({ state: "ready_for_prepress", destination: "Prepress" });
    expect(resolveOrderSaveRouteTarget({ requiresDesign: false, requiresProofApproval: false, requiresPrepress: false })).toBeNull();
  });
});
