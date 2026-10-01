import fs from "node:fs";
import path from "node:path";
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
test("shipping agent uses closed dispatch and job-bound opaque canonical URLs, not arbitrary HTML/URLs", () => {
  const agent = read("windows-print-agent/Program.cs");
  for (const type of ["traveler", "pickup_traveler", "quick_note", "packing_slip", "shipment_manifest", "package_ticket"]) expect(agent).toContain(`case "${type}":`);
  expect(agent).toContain('default: throw new InvalidOperationException("Unsupported print document type.")');
  expect(agent).toContain('/print-agent/documents/{Uri.EscapeDataString(job.id)}');
  expect(agent).toContain("!uri.IsDefaultPort"); expect(agent).toContain("!string.IsNullOrEmpty(uri.UserInfo)"); expect(agent).toContain("!string.IsNullOrEmpty(uri.Query)");
  expect(agent).toContain("WaitForShippingRender(web, job)"); expect(agent).toContain("el.dataset.printJobId"); expect(agent).toContain("el.dataset.printDocumentType"); expect(agent).toContain("el.dataset.printError");
});
test("active drain empties all wake batches but stops empty/stale batches and remains idle without HTTP polling", () => {
  const agent = read("windows-print-agent/Program.cs");
  const drain = agent.slice(agent.indexOf("static async Task DrainDirectPrintQueue"), agent.indexOf("static async Task Print(Job"));
  expect(drain).toContain("while (Volatile.Read(ref AgentShuttingDown) == 0)");
  expect(drain).toContain("discovered.Add(job.id)"); expect(drain).toContain("if (pending.Count == 0) return;"); expect(drain).toContain("await Print(job)");
  expect(drain).not.toContain("Task.Delay"); expect(agent).not.toContain("QueuePollIntervalMs");
});
