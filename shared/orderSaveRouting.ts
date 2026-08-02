export type OrderSaveRoutingMode = "save_only" | "route_eligible" | "ask_each_time";

export function normalizeOrderSaveRoutingMode(value: unknown): OrderSaveRoutingMode {
  return value === "route_eligible" || value === "ask_each_time" ? value : "save_only";
}

export function resolveOrderSaveRouteTarget(input: {
  requiresDesign: boolean;
  requiresProofApproval: boolean;
  requiresPrepress: boolean;
}) {
  if (input.requiresDesign) return { state: "needs_design" as const, destination: "Design" as const };
  if (input.requiresProofApproval) return { state: "awaiting_proof_approval" as const, destination: "Proofing" as const };
  if (input.requiresPrepress) return { state: "ready_for_prepress" as const, destination: "Prepress" as const };
  return null;
}
