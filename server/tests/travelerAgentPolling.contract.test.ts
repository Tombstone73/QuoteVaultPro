import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("Traveler print agent event-driven wake contract", () => {
  const agent = read("windows-print-agent/Program.cs");
  const project = read("windows-print-agent/PrintersHero.PrintAgent.csproj");
  const realtimeConfiguration = read("windows-print-agent/RealtimeConnectionConfiguration.cs");
  const staScheduler = read("windows-print-agent/StaQueueDrainScheduler.cs");
  const staDispatcherForm = read("windows-print-agent/TravelerStaDispatcherForm.cs");

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

  test("dispatches startup, reconnect, and Realtime wakes to one explicit STA queue scheduler", () => {
    expect(agent).toContain("using var staDispatcher = new TravelerStaDispatcherForm()");
    expect(agent).toContain("staDispatcher.Shown +=");
    expect(agent).toContain("Application.Run(staDispatcher)");
    expect(agent).not.toContain("staDispatcher.CreateControl()");
    expect(agent).not.toContain("Application.Run(new ApplicationContext())");
    expect(staDispatcherForm).toContain("public sealed class TravelerStaDispatcherForm : Form");
    expect(staDispatcherForm).toContain("ShowInTaskbar = false");
    expect(agent).toContain("static readonly StaQueueDrainScheduler QueueDrainScheduler");
    expect(agent).toContain("dispatcher.BeginInvoke");
    expect(agent).toContain('await ScheduleQueueDrainOnSta("realtime startup catch-up")');
    expect(agent).toContain('ScheduleQueueDrainOnSta("realtime reconnect catch-up")');
    expect(agent).toContain('ObserveQueueDrainSignal("realtime queue_changed wake")');
    expect(agent).not.toContain('RequestQueueDrain("realtime queue_changed wake")');
    expect(agent).toContain("foreach (var job in jobs ?? [])");
    expect(agent).toContain("await Print(job);");
  });

  test("never lets a Realtime worker create WebView2 or render outside the designated STA", () => {
    const callbackStart = agent.indexOf("broadcast.AddBroadcastEventHandler");
    const callbackEnd = agent.indexOf("clearCandidateHandlers =", callbackStart);
    const callback = agent.slice(callbackStart, callbackEnd);

    expect(callback).toContain("ObserveQueueDrainSignal");
    expect(callback).not.toContain("PrintTraveler");
    expect(callback).not.toContain("new Form");
    expect(callback).not.toContain("new WebView2");
    expect(agent).toContain("Thread.CurrentThread.GetApartmentState() == ApartmentState.STA");
    expect(agent).toContain("EnsureTravelerStaThread();");
    expect(agent).toContain("await RunOnTravelerStaAsync(() => PrintTraveler(claim))");
    expect(staScheduler).toContain("Traveler STA dispatcher is unavailable; queued work was not claimed.");
  });

  test("connects the 7.4.0 socket before creating the wake channel and retries initial Realtime failures locally", () => {
    const connect = agent.indexOf("await candidateClient.ConnectAsync()");
    const channel = agent.indexOf("candidateClient.Channel(GetWakeTopic())");

    expect(connect).toBeGreaterThan(-1);
    expect(channel).toBeGreaterThan(connect);
    expect(agent).toContain("candidateClient.Socket is null || !candidateClient.Socket.IsConnected");
    expect(agent).toContain("Supabase Realtime startup failed; retrying locally");
    expect(agent).toContain("await Task.Delay(TimeSpan.FromSeconds(retryDelaySeconds))");
    expect(agent).toContain("Math.Min(retryDelaySeconds * 2, 30)");
  });

  test("creates one subscription and cleans every failed transport attempt before retrying", () => {
    expect(agent).toContain("RealtimeStartupStarted");
    expect(agent).toContain("Interlocked.Exchange(ref RealtimeStartupStarted, 1) == 1");
    expect(agent).toContain("Interlocked.Exchange(ref RealtimeSubscriptionActive, 1) == 1");
    expect(agent).toContain("CleanupRealtimeAttempt(candidateClient, candidateChannel, clearCandidateHandlers)");
    expect(agent).toContain("ClearBroadcastEventHandlers()");
    expect(agent).toContain("ClearStateChangedHandlers()");
    expect(agent).toContain("channel?.Unsubscribe()");
    expect(agent).toContain("client.Remove(channel)");
    expect(agent).toContain("client?.Disconnect(");
  });

  test("does not reconnect a healthy Realtime subscription when local startup catch-up fails", () => {
    const subscriptionEstablished = agent.indexOf('Log("Supabase Realtime wake subscription established.")');
    const transportRetry = agent.indexOf("Supabase Realtime startup failed; retrying locally");
    const transportLoopExit = agent.indexOf("\n    }\n    try {", transportRetry);
    const startupCatchup = agent.indexOf('await ScheduleQueueDrainOnSta("realtime startup catch-up")', transportLoopExit);
    const startupCatchupFailure = agent.indexOf("Startup queue catch-up failed:", startupCatchup);

    expect(subscriptionEstablished).toBeGreaterThan(-1);
    expect(transportLoopExit).toBeGreaterThan(subscriptionEstablished);
    expect(startupCatchup).toBeGreaterThan(transportLoopExit);
    expect(startupCatchupFailure).toBeGreaterThan(startupCatchup);
    expect(transportRetry).toBeLessThan(transportLoopExit);
  });

  test("waits for the automatically rejoined channel before one reconnect catch-up and never duplicates initial open", () => {
    expect(agent).toContain("candidateChannel.AddStateChangedHandler");
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

    expect(agent).toContain('const string AgentVersion = "1.0.24"');
    expect(project).toContain("<Version>1.0.24</Version>");
    expect(setup).toContain("$script:SetupVersion = '1.0.24'");
    expect(readme).toContain("Version 1.0.24");
  });
});
