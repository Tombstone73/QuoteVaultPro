import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("local bridge heartbeat version safety", () => {
  const routes = read("server/routes/localBridge.routes.ts");

  test("updates only a valid numeric executable version on the authenticated paired agent", () => {
    expect(routes).toContain('import { isNumericAgentVersion } from "../lib/directPrintAgentCapabilities"');
    expect(routes).toContain("const agent = req.bridgeAgent;");
    expect(routes).toContain("isNumericAgentVersion(reportedVersion) ? reportedVersion : agent.agentVersion");
    expect(routes).toContain("where(eq(localBridgeAgents.id, agent.id))");
  });

  test("does not let missing or diagnostic text erase the stored executable version", () => {
    expect(routes).not.toContain("agentVersion: req.body?.agentVersion || null");
    expect(routes).toContain("agentVersion, updatedAt");
    expect(routes).toContain('data: { status: "active", agentVersion }');
  });
});
