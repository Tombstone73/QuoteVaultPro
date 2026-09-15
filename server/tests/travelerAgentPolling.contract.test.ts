import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("Traveler print agent event-driven wake contract", () => {
  const agent = read("windows-print-agent/Program.cs");
  const project = read("windows-print-agent/PrintersHero.PrintAgent.csproj");
  const realtimeConfiguration = read("windows-print-agent/RealtimeConnectionConfiguration.cs");

  test("uses Supabase Realtime directly and never schedules a recurring Railway poll or heartbeat", () => {
    expect(project).toContain('PackageReference Include="Supabase.Realtime"');
    expect(agent).toContain("new Client(realtimeBaseEndpoint, RealtimeConnectionConfiguration.CreateClientOptions(SupabasePublishableKey))");
    expect(agent).toContain("Supabase Realtime endpoint host:");
    expect(agent).toContain("Supabase publishable key configured: yes.");
    expect(realtimeConfiguration).toContain('Path = "/realtime/v1"');
    expect(realtimeConfiguration).toContain("Parameters = new SocketOptionsParameters");
    expect(realtimeConfiguration).toContain("ApiKey = publishableKey");
    expect(realtimeConfiguration).not.toContain("/websocket");
    expect(realtimeConfiguration).not.toContain("apikey=");
    expect(realtimeConfiguration).not.toContain("vsn=");
    expect(agent).not.toContain("SetAuth(SupabasePublishableKey)");
    expect(agent).not.toContain("Bearer {SupabasePublishableKey}");
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

  test("connects the 7.4.0 socket before creating the wake channel and retries initial Realtime failures locally", () => {
    const connect = agent.indexOf("await RealtimeClient.ConnectAsync()");
    const channel = agent.indexOf("RealtimeClient.Channel(GetWakeTopic())");

    expect(connect).toBeGreaterThan(-1);
    expect(channel).toBeGreaterThan(connect);
    expect(agent).toContain("RealtimeClient.Socket is null || !RealtimeClient.Socket.IsConnected");
    expect(agent).toContain("Supabase Realtime startup failed; retrying locally");
    expect(agent).toContain("await Task.Delay(TimeSpan.FromSeconds(retryDelaySeconds))");
    expect(agent).toContain("Math.Min(retryDelaySeconds * 2, 30)");
  });

  test("waits for the automatically rejoined channel before one reconnect catch-up and never duplicates initial open", () => {
    expect(agent).toContain("channel.AddStateChangedHandler");
    expect(agent).toContain("ChannelState.Joined");
    expect(agent).toContain("RealtimeInitialSubscriptionComplete");
    expect(agent).toContain("RealtimeReconnectCatchupPending");
    expect(agent).toContain("connection > 1 && Volatile.Read(ref RealtimeInitialSubscriptionComplete) == 1");
    expect(agent).toContain("Interlocked.Exchange(ref RealtimeReconnectCatchupPending, 0) == 1");
    expect(agent).toContain("Supabase Realtime wake subscription restored.");
  });

  test("keeps safe non-sensitive pipeline diagnostics", () => {
    for (const marker of [
      "Queue job discovered:", "Queue job claimed:", "Traveler navigation started:",
      "Traveler navigation succeeded:", "Direct-print source response:",
      "Traveler ready marker reached.", "WebView2 PrintAsync submitted.", "Windows accepted job",
    ]) expect(agent).toContain(marker);
  });

  test("keeps the agent and setup release version aligned", () => {
    const setup = read("windows-print-agent/setup-agent.ps1");
    const readme = read("windows-print-agent/README.md");

    expect(agent).toContain('const string AgentVersion = "1.0.22"');
    expect(setup).toContain("$script:SetupVersion = '1.0.22'");
    expect(readme).toContain("Version 1.0.22");
  });
});
