import { canAgentServeQueue } from "../services/printAgentQueueMapping";

describe("paired Print Agent queue mapping", () => {
  const legacy = { agentVersion: "1.0.27", configuredTravelerPrinterName: "EPSON TM-L90", knownWindowsQueues: ["EPSON TM-L90", "Zebra ZD421"] };
  it("preserves the original Traveler queue on older installations", () => {
    expect(canAgentServeQueue(legacy, "EPSON TM-L90")).toBe(true);
    expect(canAgentServeQueue(legacy, "Zebra ZD421")).toBe(false);
  });
  it("allows an updated paired installation to serve each reported queue", () => {
    const updated = { ...legacy, agentVersion: "1.0.28" };
    expect(canAgentServeQueue(updated, "EPSON TM-L90")).toBe(true);
    expect(canAgentServeQueue(updated, "Zebra ZD421")).toBe(true);
    expect(canAgentServeQueue(updated, "unreported queue")).toBe(false);
  });
  it("fails closed for missing identity or missing queue", () => {
    expect(canAgentServeQueue(null, "Zebra ZD421")).toBe(false);
    expect(canAgentServeQueue({ agentVersion: "1.0.28", configuredTravelerPrinterName: null, knownWindowsQueues: [] }, "Zebra ZD421")).toBe(false);
  });
});
