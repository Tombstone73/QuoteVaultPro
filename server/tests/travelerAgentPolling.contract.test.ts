import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("Traveler print agent event-driven wake contract", () => {
  const agent = read("windows-print-agent/Program.cs");
  const project = read("windows-print-agent/PrintersHero.PrintAgent.csproj");

  test("uses Supabase Realtime directly and never schedules a recurring Railway poll or heartbeat", () => {
    expect(project).toContain('PackageReference Include="Supabase.Realtime"');
    expect(agent).toContain("new Client(GetRealtimeEndpoint(), options)");
    expect(agent).toContain("/realtime/v1/websocket");
    expect(agent).not.toContain("QueuePollIntervalMs");
    expect(agent).not.toContain("HeartbeatIntervalMs");
    expect(agent).not.toContain("SendHeartbeatAsync");
    expect(agent).not.toContain('Post("/api/local-bridge/heartbeat"');
    expect(agent).not.toContain("timer.Interval =");
  });

  test("derives a high-entropy agent-specific wake topic without logging tokens or topics", () => {
    expect(agent).toContain("SHA256.HashData(Encoding.UTF8.GetBytes(Token))");
    expect(agent).toContain("printershero:traveler-wake:");
    expect(agent).not.toContain('Log(GetWakeTopic');
    expect(agent).not.toContain('Log($"Bearer {Token}")');
  });

  test("catches up on startup and reconnect, while serializing duplicate wakes", () => {
    expect(agent).toContain('await RequestQueueDrain("realtime startup catch-up")');
    expect(agent).toContain('RequestQueueDrain("realtime reconnect catch-up")');
    expect(agent).toContain('RequestQueueDrain("realtime queue_changed wake")');
    expect(agent).toContain("static readonly SemaphoreSlim QueueDrainGate");
    expect(agent).toContain("await QueueDrainGate.WaitAsync(0)");
    expect(agent).toContain("foreach (var job in jobs ?? [])");
    expect(agent).toContain("await Print(job);");
  });

  test("keeps safe non-sensitive pipeline diagnostics", () => {
    for (const marker of [
      "Queue job discovered:", "Queue job claimed:", "Traveler navigation started:",
      "Traveler navigation succeeded:", "Direct-print source response:",
      "Traveler ready marker reached.", "WebView2 PrintAsync submitted.", "Windows accepted job",
    ]) expect(agent).toContain(marker);
  });
});
