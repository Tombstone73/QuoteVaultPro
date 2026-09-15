import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("Traveler print agent polling contract", () => {
  const agent = read("windows-print-agent/Program.cs");

  test("checks the direct-print queue well below the former 15-second interval", () => {
    expect(agent).toContain("const int QueuePollIntervalMs = 1500;");
    expect(agent).toContain("timer.Interval = QueuePollIntervalMs; timer.Start();");
    expect(agent).not.toContain("timer.Interval = 15000");
  });

  test("keeps heartbeat monitoring substantially slower and independent of queue work", () => {
    expect(agent).toContain("const int HeartbeatIntervalMs = 60000;");
    expect(agent).toContain("TryHeartbeatIfDue();");
    expect(agent).toContain("_ = SendHeartbeatAsync();");
    expect(agent).toContain("Heartbeat failure:");
    expect(agent).toContain("await PollDirectPrintQueue();");
  });

  test("serializes queue polls and Traveler jobs while allowing failed polls to recover", () => {
    expect(agent).toContain("timer.Stop();");
    expect(agent).toContain("finally { timer.Interval = QueuePollIntervalMs; timer.Start(); }");
    expect(agent).toContain("foreach (var job in jobs ?? [])");
    expect(agent).toContain("await Print(job);");
    expect(agent).toContain("Queue poll failure:");
    expect(agent).toContain('Post<Claim>($"/api/local-bridge/direct-print/jobs/{job.id}/claim"');
  });

  test("records each non-sensitive pipeline milestone", () => {
    for (const marker of [
      "Queue job discovered:",
      "Queue job claimed:",
      "Traveler navigation started:",
      "Traveler navigation succeeded:",
      "Direct-print source response:",
      "Traveler ready marker reached.",
      "WebView2 PrintAsync submitted.",
      "Windows accepted job",
    ]) expect(agent).toContain(marker);
    expect(agent).not.toContain('Log($"Bearer {Token}")');
  });
});
