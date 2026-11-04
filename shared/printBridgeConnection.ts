import { z } from "zod";

export const bridgeConnectionSchema = z.object({
  state: z.enum(["connected", "reconnecting", "disconnected", "authentication_required"]),
  // Only fixed diagnostic categories cross the agent boundary, never raw exceptions.
  error: z.enum(["realtime_unavailable", "api_unavailable", "pairing_required"]).nullable(),
}).strict();
export type BridgeConnectionReport = z.infer<typeof bridgeConnectionSchema>;
export type BridgeConnectionHealth = BridgeConnectionReport & { reportedAt: string };
export function bridgeConnectionLabel(status: string, health?: BridgeConnectionHealth | null, now = Date.now()): string {
  if (status === "revoked") return "Authentication Required";
  if (!health) return "Connection not reported · update agent";
  if (!Number.isFinite(Date.parse(health.reportedAt)) || now - Date.parse(health.reportedAt) > 90_000) return "Disconnected · heartbeat overdue";
  return ({ connected: "Connected", reconnecting: "Reconnecting", disconnected: "Disconnected",
    authentication_required: "Authentication Required" })[health.state];
}
