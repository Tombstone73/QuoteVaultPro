using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Web.WebView2.Core;
using System.Drawing.Printing;
using Supabase.Realtime;
using Supabase.Realtime.Broadcast;
using Supabase.Realtime.Models;

namespace PrintersHero.PrintAgent;
record Job(string id, string? orderId, string? documentType, JsonElement? printContext, int copies, string? printNote, decimal trailingFeedMm, string? queueName, string? destinationName, string? location);
record HeartbeatResponse(bool hasPendingDirectPrintJobs);
record Claim(string id, string? orderId, string? documentType, JsonElement? printContext, int copies, string? printNote, decimal trailingFeedMm, string? travelerUrl, string? queueName);
sealed class QueueChangedBroadcast : BaseBroadcast { }
static class Program {
  const string AgentVersion = "1.0.32";
  const decimal BaseTravelerTrailingFeedMm = 38.1m;
  const decimal MaxAdditionalTrailingFeedMm = 100m;
  static readonly string BaseUrl = (Environment.GetEnvironmentVariable("PRINTERSHERO_API_BASE_URL") ?? "").TrimEnd('/');
  static readonly string Token = Environment.GetEnvironmentVariable("PRINTERSHERO_AGENT_TOKEN") ?? "";
  static readonly string TravelerPrinter = (Environment.GetEnvironmentVariable("PRINTERSHERO_TRAVELER_PRINTER") ?? "").Trim();
  static readonly string SupabaseUrl = (Environment.GetEnvironmentVariable("PRINTERSHERO_SUPABASE_URL") ?? "").TrimEnd('/');
  static readonly string SupabasePublishableKey = Environment.GetEnvironmentVariable("PRINTERSHERO_SUPABASE_PUBLISHABLE_KEY") ?? "";
  static readonly string LogPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PrintersHero", "print-agent.log");
  static readonly object LogGate = new();
  static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(20) };
  static BridgeTrayController? Tray;
  static string ConnectionState = "reconnecting";
  static string? ConnectionError;
  static DateTimeOffset? LastHeartbeat;
  static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { NumberHandling = JsonNumberHandling.AllowReadingFromString };
  static readonly HashSet<string> CanonicalTravelerWebHosts = new(StringComparer.OrdinalIgnoreCase) { "www.printershero.com", "dev.printershero.com" };
  static readonly StaQueueDrainScheduler QueueDrainScheduler = new(DispatchQueueDrainToSta, DrainDirectPrintQueue, Log);
  static TravelerStaDispatcherForm? StaDispatcher;
  static int StaDispatcherThreadId;
  static int AgentShuttingDown;
  static int RealtimeStartupStarted;
  static Client? RealtimeClient;
  static RealtimeChannel? RealtimeChannel;
  static Action? ClearRealtimeHandlers;
  [STAThread] static void Main(string[] args) {
    if (args.Contains("--list-printers", StringComparer.OrdinalIgnoreCase)) { foreach (var queue in PrinterSettings.InstalledPrinters.Cast<string>()) Console.WriteLine(queue); return; }
    if (string.IsNullOrWhiteSpace(BaseUrl) || string.IsNullOrWhiteSpace(Token) || string.IsNullOrWhiteSpace(TravelerPrinter) || string.IsNullOrWhiteSpace(SupabaseUrl) || string.IsNullOrWhiteSpace(SupabasePublishableKey)) throw new InvalidOperationException("PRINTERSHERO_API_BASE_URL, PRINTERSHERO_AGENT_TOKEN, PRINTERSHERO_TRAVELER_PRINTER, PRINTERSHERO_SUPABASE_URL, and PRINTERSHERO_SUPABASE_PUBLISHABLE_KEY are required.");
    Http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token);
    Log("Agent started.");
    ApplicationConfiguration.Initialize();
    using var staDispatcher = new TravelerStaDispatcherForm();
    using var tray = new BridgeTrayController(() => QueueDrainScheduler.IsBusy, QueueDrainScheduler.TryReserveRestart, QueueDrainScheduler.CancelRestart);
    Tray = tray;
    staDispatcher.Shown += (_, _) => {
      if (Interlocked.Exchange(ref RealtimeStartupStarted, 1) == 1) return;
      StaDispatcher = staDispatcher;
      StaDispatcherThreadId = Environment.CurrentManagedThreadId;
      if (!staDispatcher.IsHandleCreated || staDispatcher.IsDisposed || Thread.CurrentThread.GetApartmentState() != ApartmentState.STA) {
        throw new InvalidOperationException("Traveler STA dispatcher did not become ready.");
      }
      Log($"Traveler STA dispatcher ready on thread {StaDispatcherThreadId}.");
      _ = ReportPresenceLoop();
      _ = ObserveRealtimeStartup();
    };
    staDispatcher.FormClosed += (_, _) => {
      Interlocked.Exchange(ref AgentShuttingDown, 1);
      QueueDrainScheduler.Shutdown();
      CleanupRealtimeAttempt(RealtimeClient, RealtimeChannel, ClearRealtimeHandlers);
      StaDispatcher = null;
    };
    Application.Run(staDispatcher);
  }
  static void Log(string message) { try { lock (LogGate) { Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!); File.AppendAllText(LogPath, $"{DateTimeOffset.UtcNow:O} {message}{Environment.NewLine}"); } } catch (IOException) { /* Diagnostics must not stop recovery or duplicate a print. */ } }
  static void SetConnection(string state, string? error = null) {
    if (ConnectionState == "authentication_required") return;
    ConnectionState = state; ConnectionError = error;
  }
  static async Task ReportPresenceLoop() {
    while (Volatile.Read(ref AgentShuttingDown) == 0) {
      await ReportAgentPresenceAsync();
      var label = ConnectionState switch { "connected" => "Connected", "reconnecting" => "Reconnecting", "authentication_required" => "Authentication Required", _ => "Disconnected" };
      var detail = $"{label}\nLast heartbeat: {(LastHeartbeat?.ToLocalTime().ToString("g") ?? "not confirmed")}\n" +
        (ConnectionError == "pairing_required" ? "Run setup-agent.cmd to pair again." : ConnectionError == "api_unavailable" ? "API unreachable; check network and API host." : ConnectionError == "realtime_unavailable" ? "Wake channel unavailable; reconnecting automatically." : "No connection error reported.");
      var dispatcher = StaDispatcher;
      if (dispatcher is not null && !dispatcher.IsDisposed) { try { dispatcher.BeginInvoke(new Action(() => Tray?.Update(detail))); } catch (InvalidOperationException) { } }
      await Task.Delay(TimeSpan.FromSeconds(30));
    }
  }
  // Reuse the authenticated heartbeat to discover missed wakes; only queued jobs are eligible.
  // The paired token scopes every heartbeat to this installation.
  static async Task ReportAgentPresenceAsync() {
    try {
      if (ConnectionState != "authentication_required" && RealtimeClient?.Socket?.IsConnected == true && RealtimeChannel?.State == Supabase.Realtime.Constants.ChannelState.Joined) SetConnection("connected");
      var windowsQueues = PrinterSettings.InstalledPrinters.Cast<string>().ToArray();
      var heartbeat = await Post<HeartbeatResponse>("/api/local-bridge/heartbeat", new { name = Environment.MachineName, agentVersion = AgentVersion, windowsQueues, connection = new { state = ConnectionState, error = ConnectionError } });
      if (heartbeat?.hasPendingDirectPrintJobs == true) _ = ObserveQueueDrainSignal("heartbeat pending-queue catch-up");
      LastHeartbeat = DateTimeOffset.UtcNow;
      Log($"Agent version {AgentVersion} registered with PrintersHero.");
    } catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.Unauthorized || ex.StatusCode == System.Net.HttpStatusCode.Forbidden) {
      ConnectionState = "authentication_required"; ConnectionError = "pairing_required";
      Log("Agent authentication required. Run setup-agent.cmd to pair again.");
    } catch { SetConnection("disconnected", "api_unavailable"); Log("Agent heartbeat failed: API unavailable."); }
  }
  static bool IsTravelerStaThread() => Environment.CurrentManagedThreadId == StaDispatcherThreadId && Thread.CurrentThread.GetApartmentState() == ApartmentState.STA;
  static void EnsureTravelerStaThread() {
    if (!IsTravelerStaThread()) throw new InvalidOperationException("Traveler rendering must run on the designated WinForms STA thread.");
  }
  static Task RunOnTravelerStaAsync(Func<Task> operation) {
    if (IsTravelerStaThread()) return operation();
    var dispatcher = StaDispatcher;
    if (Volatile.Read(ref AgentShuttingDown) == 1 || dispatcher is null || dispatcher.IsDisposed || !dispatcher.IsHandleCreated) return Task.FromException(new InvalidOperationException("Traveler STA dispatcher is unavailable; rendering was not started."));
    var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    try {
      dispatcher.BeginInvoke(new Action(async () => {
        try {
          EnsureTravelerStaThread();
          await operation();
          completion.TrySetResult();
        } catch (Exception ex) { completion.TrySetException(ex); }
      }));
    } catch (Exception ex) { completion.TrySetException(ex); }
    return completion.Task;
  }
  static bool DispatchQueueDrainToSta(Func<Task> operation) {
    var dispatcher = StaDispatcher;
    if (Volatile.Read(ref AgentShuttingDown) == 1 || dispatcher is null || dispatcher.IsDisposed || !dispatcher.IsHandleCreated) return false;
    try {
      dispatcher.BeginInvoke(new Action(async () => {
        try {
          EnsureTravelerStaThread();
          await operation();
        } catch (Exception ex) { Log($"Traveler STA queue dispatch failed: {ex.Message}"); }
      }));
      Log("Queue drain dispatched to STA.");
      return true;
    } catch (Exception ex) {
      Log($"Traveler STA dispatcher unavailable: {ex.Message}");
      return false;
    }
  }
  static string GetWakeTopic() {
    var tokenHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Token))).ToLowerInvariant();
    return $"printershero:traveler-wake:{tokenHash}";
  }
  static string GetRealtimeBaseEndpoint() => RealtimeConnectionConfiguration.GetRealtimeBaseEndpoint(SupabaseUrl);
  static async Task ObserveRealtimeStartup() {
    try { await StartRealtimeWakeSubscriber(); }
    catch (Exception ex) { Log($"Realtime wake subscriber stopped: {ex.Message}"); }
  }
  static async Task StartRealtimeWakeSubscriber() {
    var retryDelaySeconds = 3;
    while (Volatile.Read(ref AgentShuttingDown) == 0) {
      Client? candidateClient = null;
      RealtimeChannel? candidateChannel = null;
      Action? clearCandidateHandlers = null;
      try {
        SetConnection("reconnecting", "realtime_unavailable");
        var monitor = new BridgeConnectionMonitor();
        var initialJoin = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        candidateClient = new Client(GetRealtimeBaseEndpoint(), RealtimeConnectionConfiguration.CreateClientOptions(SupabasePublishableKey));
        candidateClient.AddStateChangedHandler((_, state) => {
          if (state is Supabase.Realtime.Constants.SocketState.Close or Supabase.Realtime.Constants.SocketState.Error)
            SetConnection("disconnected", "realtime_unavailable");
          else if (state == Supabase.Realtime.Constants.SocketState.Reconnect) SetConnection("reconnecting", "realtime_unavailable");
        });
        // Connect before Channel: required by the installed SDK.
        var connecting = candidateClient.ConnectAsync();
        try { await connecting.WaitAsync(TimeSpan.FromSeconds(20)); }
        catch {
          var abandoned = candidateClient;
          _ = connecting.ContinueWith(_ => CleanupRealtimeAttempt(abandoned, null, null), TaskScheduler.Default);
          throw;
        }
        candidateChannel = candidateClient.Channel(GetWakeTopic());
        candidateChannel.AddStateChangedHandler((sender, state) => {
          if (state == Supabase.Realtime.Constants.ChannelState.Joined) {
            SetConnection("connected");
            initialJoin.TrySetResult();
            // Channel-only rejoins also need catch-up (no socket Open event).
            if (monitor.OnJoined()) _ = CompleteReconnectCatchup();
          } else SetConnection("reconnecting", "realtime_unavailable");
        });
        var broadcast = candidateChannel.Register<QueueChangedBroadcast>(broadcastSelf: false, broadcastAck: false);
        broadcast.AddBroadcastEventHandler((sender, response) => {
          if (string.Equals(broadcast.Current()?.Event, "queue_changed", StringComparison.Ordinal)) _ = ObserveQueueDrainSignal("realtime queue_changed wake");
        });
        clearCandidateHandlers = () => { broadcast.ClearBroadcastEventHandlers(); candidateChannel.ClearStateChangedHandlers(); candidateClient.ClearStateChangedHandlers(); };
        await candidateChannel.Subscribe().WaitAsync(TimeSpan.FromSeconds(20));
        await initialJoin.Task.WaitAsync(TimeSpan.FromSeconds(20));
        RealtimeClient = candidateClient; RealtimeChannel = candidateChannel; ClearRealtimeHandlers = clearCandidateHandlers;
        try { await ScheduleQueueDrainOnSta("realtime startup catch-up"); }
        catch { Log("Startup queue catch-up failed; the healthy wake connection remains active."); }
        retryDelaySeconds = 3;
        while (Volatile.Read(ref AgentShuttingDown) == 0) {
          await Task.Delay(TimeSpan.FromSeconds(5));
          var ready = candidateClient.Socket?.IsConnected == true && candidateChannel.State == Supabase.Realtime.Constants.ChannelState.Joined;
          if (monitor.NeedsRestart(ready, DateTimeOffset.UtcNow)) throw new InvalidOperationException("Wake channel did not recover within 60 seconds.");
        }
      } catch { Log("Wake connection unavailable; retrying with bounded local backoff."); }
      finally { CleanupRealtimeAttempt(candidateClient, candidateChannel, clearCandidateHandlers); }
      if (Volatile.Read(ref AgentShuttingDown) == 0) {
        SetConnection("reconnecting", "realtime_unavailable");
        await Task.Delay(TimeSpan.FromSeconds(retryDelaySeconds));
        retryDelaySeconds = Math.Min(retryDelaySeconds * 2, 30);
      }
    }
  }
  static void CleanupRealtimeAttempt(Client? client, RealtimeChannel? channel, Action? clearHandlers) {
    try { client?.ClearStateChangedHandlers(); channel?.ClearStateChangedHandlers(); clearHandlers?.Invoke(); } catch (Exception ex) { Log($"Realtime handler cleanup warning: {ex.Message}"); }
    try { channel?.Unsubscribe(); } catch (Exception ex) { Log($"Realtime channel cleanup warning: {ex.Message}"); }
    try { if (client is not null && channel is not null) client.Remove(channel); } catch (Exception ex) { Log($"Realtime channel removal warning: {ex.Message}"); }
    try { client?.Disconnect(System.Net.WebSockets.WebSocketCloseStatus.NormalClosure, "PrintersHero Realtime attempt cleanup"); } catch (Exception ex) { Log($"Realtime socket cleanup warning: {ex.Message}"); }
    if (ReferenceEquals(RealtimeClient, client)) RealtimeClient = null;
    if (ReferenceEquals(RealtimeChannel, channel)) RealtimeChannel = null;
    if (ReferenceEquals(ClearRealtimeHandlers, clearHandlers)) ClearRealtimeHandlers = null;
  }
  static async Task CompleteReconnectCatchup() {
    try {
      Log("Supabase Realtime wake subscription restored.");
      await ScheduleQueueDrainOnSta("realtime reconnect catch-up");
      Log("Reconnect queue catch-up completed.");
    } catch (Exception ex) { Log($"Reconnect queue catch-up failed: {ex.Message}"); }
  }
  static Task ScheduleQueueDrainOnSta(string reason) => QueueDrainScheduler.Request(reason);
  static async Task ObserveQueueDrainSignal(string reason) {
    try { await ScheduleQueueDrainOnSta(reason); }
    catch (Exception ex) { Log($"Queue drain signal failed ({reason}): {ex.Message}"); }
  }
  static async Task DrainDirectPrintQueue(string reason) {
    var discovered = new HashSet<string>(StringComparer.Ordinal);
    while (Volatile.Read(ref AgentShuttingDown) == 0) {
      List<Job>? jobs;
      try {
        jobs = await Get<List<Job>>("/api/local-bridge/direct-print/jobs");
      } catch (Exception ex) {
        Log($"Queue drain failed ({reason}): {ex.Message}");
        return;
      }
      var pending = (jobs ?? []).Where(job => discovered.Add(job.id)).ToList();
      // Stop after empty/stale batches, never turn a wake into idle polling.
      if (pending.Count == 0) return;
      foreach (var job in pending) {
        Log($"Queue job discovered: {job.id}.");
        await Print(job);
      }
    }
  }
  static async Task Print(Job job) {
    Claim? claim;
    try { claim = await Post<Claim>($"/api/local-bridge/direct-print/jobs/{job.id}/claim", new { }); }
    catch (Exception ex) { Log($"Job {job.id} claim failed: {ex.Message}"); return; }
    if (claim is null) return;
    Log($"Queue job claimed: {job.id} ({claim.documentType}).");
    var windowsAccepted = false;
    try {
      if (claim.id != job.id) throw new InvalidOperationException("Claim does not match the requested print job.");
      if (string.IsNullOrWhiteSpace(claim.queueName) || !QueueExists(claim.queueName)) throw new InvalidOperationException("The assigned Windows printer queue is unavailable on this workstation. Check the paired profile and installed driver.");
      Log($"Preparing job {job.id} for {claim.queueName}; Windows submission has not occurred.");
      switch (claim.documentType) {
        case "traveler":
        case "pickup_traveler":
        case "packing_slip":
        case "shipment_manifest":
        case "package_ticket":
        case "ups_label":
        case "production_item_label":
        case "profile_test": await RunOnTravelerStaAsync(() => PrintTraveler(claim)); break;
        case "quick_note": await RunOnTravelerStaAsync(() => PrintQuickNote(claim)); break;
        default: throw new InvalidOperationException("Unsupported print document type.");
      }
      windowsAccepted = true;
      await Post($"/api/local-bridge/direct-print/jobs/{job.id}/submitted", new { });
      Log($"Windows accepted job {job.id}.");
    } catch (Exception ex) {
      if (windowsAccepted) {
        Log($"Job {job.id} was accepted by Windows, but server acknowledgement failed. Outcome requires operator review; no automatic replay. {ex.Message}");
        return;
      }
      Log($"Job {job.id} failed: {ex.Message}");
      await Post($"/api/local-bridge/direct-print/jobs/{job.id}/failed", new { error = ex.Message });
    }
  }
  // The Windows spooler is queried locally; the server never accepts a queue
  // supplied by an operator. Status failures still fail closed at PrintAsync.
  static bool QueueExists(string queue) => PrinterSettings.InstalledPrinters.Cast<string>().Any(name => string.Equals(name, queue, StringComparison.OrdinalIgnoreCase));
  static Uri GetApiOrigin() {
    if (!Uri.TryCreate(BaseUrl, UriKind.Absolute, out var apiOrigin) || apiOrigin.Scheme != Uri.UriSchemeHttps || !string.IsNullOrEmpty(apiOrigin.Query) || !string.IsNullOrEmpty(apiOrigin.Fragment)) throw new InvalidOperationException("PRINTERSHERO_API_BASE_URL must be an HTTPS API origin.");
    return apiOrigin;
  }
  static string? GetQueryParameter(Uri uri, string key) {
    foreach (var pair in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries)) {
      var separator = pair.IndexOf('=');
      var name = Uri.UnescapeDataString(separator >= 0 ? pair[..separator] : pair);
      if (!string.Equals(name, key, StringComparison.Ordinal)) continue;
      return Uri.UnescapeDataString(separator >= 0 ? pair[(separator + 1)..] : "");
    }
    return null;
  }
  static Uri GetTravelerNavigationUri(Claim job) {
    if (UsesClaimedDocument(job.documentType)) return GetShippingNavigationUri(job);
    if (string.IsNullOrWhiteSpace(job.travelerUrl) || !Uri.TryCreate(job.travelerUrl, UriKind.Absolute, out var travelerUri)) throw new InvalidOperationException("PrintersHero did not return an absolute Traveler web URL.");
    if (travelerUri.Scheme != Uri.UriSchemeHttps || !CanonicalTravelerWebHosts.Contains(travelerUri.Host)) throw new InvalidOperationException("PrintersHero returned a noncanonical Traveler web URL.");
    if (string.IsNullOrWhiteSpace(job.orderId)) throw new InvalidOperationException("Traveler print job is missing its order id.");
    var expectedPath = $"/orders/{Uri.EscapeDataString(job.orderId)}/traveler";
    if (!string.Equals(travelerUri.AbsolutePath, expectedPath, StringComparison.Ordinal) || !string.Equals(GetQueryParameter(travelerUri, "directPrintJobId"), job.id, StringComparison.Ordinal)) throw new InvalidOperationException("PrintersHero returned an invalid Traveler print route.");
    return travelerUri;
  }
  static bool IsShippingDocument(string? type) => type is "packing_slip" or "shipment_manifest" or "package_ticket" or "ups_label" or "profile_test";
  static bool UsesClaimedDocument(string? type) => IsShippingDocument(type) || type == "production_item_label";
  static Uri GetShippingNavigationUri(Claim job) {
    if (!UsesClaimedDocument(job.documentType) || string.IsNullOrWhiteSpace(job.travelerUrl) || !Uri.TryCreate(job.travelerUrl, UriKind.Absolute, out var uri)) throw new InvalidOperationException("Claimed document print URL unavailable.");
    if (uri.Scheme != Uri.UriSchemeHttps || !CanonicalTravelerWebHosts.Contains(uri.Host) || !uri.IsDefaultPort || !string.IsNullOrEmpty(uri.UserInfo)
      || !string.Equals(uri.AbsolutePath, $"/print-agent/documents/{Uri.EscapeDataString(job.id)}", StringComparison.Ordinal)
      || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment)) throw new InvalidOperationException("Invalid shipping document print route.");
    return uri;
  }
  static Uri GetQuickNoteNavigationUri(Claim job) {
    if (string.IsNullOrWhiteSpace(job.travelerUrl) || !Uri.TryCreate(job.travelerUrl, UriKind.Absolute, out var noteUri)) throw new InvalidOperationException("PrintersHero did not return an absolute Quick Note web URL.");
    if (noteUri.Scheme != Uri.UriSchemeHttps || !CanonicalTravelerWebHosts.Contains(noteUri.Host)) throw new InvalidOperationException("PrintersHero returned a noncanonical Quick Note web URL.");
    if (!string.Equals(noteUri.AbsolutePath, "/print/quick-note", StringComparison.Ordinal) || !string.Equals(GetQueryParameter(noteUri, "directPrintJobId"), job.id, StringComparison.Ordinal)) throw new InvalidOperationException("PrintersHero returned an invalid Quick Note print route.");
    return noteUri;
  }
  static async Task PrintQuickNote(Claim job) {
    EnsureTravelerStaThread();
    using var form = new Form { Width = 1, Height = 1, ShowInTaskbar = false, Opacity = 0 };
    using var web = new WebView2 { Dock = DockStyle.Fill }; form.Controls.Add(web); form.Show(); await web.EnsureCoreWebView2Async();
    var apiOrigin = GetApiOrigin().GetLeftPart(UriPartial.Authority); var noteUri = GetQuickNoteNavigationUri(job); Log($"Quick Note navigation host: {noteUri.Host}.");
    web.CoreWebView2.AddWebResourceRequestedFilter($"{apiOrigin}/*", CoreWebView2WebResourceContext.All);
    web.CoreWebView2.WebResourceRequested += (_, e) => { if (Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var requestUri) && string.Equals(requestUri.GetLeftPart(UriPartial.Authority), apiOrigin, StringComparison.OrdinalIgnoreCase) && requestUri.AbsolutePath.StartsWith("/api/local-bridge/direct-print/jobs/", StringComparison.OrdinalIgnoreCase)) e.Request.Headers.SetHeader("Authorization", $"Bearer {Token}"); };
    var tokenJson = JsonSerializer.Serialize(Token); var apiOriginJson = JsonSerializer.Serialize(apiOrigin);
    await web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync($@"(()=>{{const token={tokenJson};const origin={apiOriginJson};const f=window.fetch.bind(window);window.fetch=(input,init={{}})=>{{const u=new URL(typeof input==='string'?input:input.url,window.location.href);if(u.origin===origin&&u.pathname.startsWith('/api/local-bridge/direct-print/jobs/')){{const h=new Headers(init.headers);h.set('Authorization','Bearer '+token);return f(input,{{...init,headers:h}});}}return f(input,init);}};}})();");
    var ready = new TaskCompletionSource(); web.CoreWebView2.NavigationCompleted += (_, e) => { if (e.IsSuccess) { Log("Quick Note navigation succeeded."); ready.TrySetResult(); } else { Log($"Quick Note navigation failed: {e.WebErrorStatus}."); ready.TrySetException(new InvalidOperationException("Quick Note render navigation failed.")); } };
    var additionalFeedMm = NormalizeAdditionalTrailingFeedMm(job.trailingFeedMm); var separator = noteUri.Query.Length > 0 ? "&" : "?"; web.CoreWebView2.Navigate($"{noteUri}{separator}feedMm={additionalFeedMm.ToString("0.##", CultureInfo.InvariantCulture)}"); await ready.Task.WaitAsync(TimeSpan.FromSeconds(30));
    var deadline = DateTime.UtcNow.AddSeconds(30); var quickNoteReady = false; while (DateTime.UtcNow < deadline) { var rendered = await web.ExecuteScriptAsync("Boolean(document.querySelector('[data-traveler-ready=\\\"true\\\"]'))"); if (rendered.Contains("true", StringComparison.OrdinalIgnoreCase)) { quickNoteReady = true; Log("Quick Note render ready."); break; } await Task.Delay(100); }; if (!quickNoteReady) throw new InvalidOperationException("Quick Note content did not finish rendering.");
    var settings = web.CoreWebView2.Environment.CreatePrintSettings(); settings.PrinterName = job.queueName; settings.Copies = job.copies; settings.ShouldPrintBackgrounds = true; settings.ShouldPrintHeaderAndFooter = false; Log("Quick Note WebView2 PrintAsync submitted."); var status = await web.CoreWebView2.PrintAsync(settings); Log($"Quick Note WebView2 print status: {status}."); if (status != CoreWebView2PrintStatus.Succeeded) throw new InvalidOperationException($"WebView2 print failed: {status}");
  }
  static async Task PrintTraveler(Claim job) {
    EnsureTravelerStaThread();
    using var form = new Form { Width = 1, Height = 1, ShowInTaskbar = false, Opacity = 0 };
    using var web = new WebView2 { Dock = DockStyle.Fill };
    form.Controls.Add(web);
    form.Show();
    await web.EnsureCoreWebView2Async();

    var apiOrigin = GetApiOrigin().GetLeftPart(UriPartial.Authority);
    var travelerUri = GetTravelerNavigationUri(job);
    web.CoreWebView2.AddWebResourceRequestedFilter($"{apiOrigin}/*", CoreWebView2WebResourceContext.All);
    web.CoreWebView2.WebResourceRequested += (_, e) => {
      if (Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var requestUri)
        && string.Equals(requestUri.GetLeftPart(UriPartial.Authority), apiOrigin, StringComparison.OrdinalIgnoreCase)
        && requestUri.AbsolutePath.StartsWith("/api/local-bridge/direct-print/jobs/", StringComparison.OrdinalIgnoreCase)) {
        e.Request.Headers.SetHeader("Authorization", $"Bearer {Token}");
      }
    };
    // The existing request interceptor covers page resources. Also patch fetch
    // before React starts so the claimed-job request always carries the bridge
    // credential when the Traveler app loads off-screen.
    var tokenJson = JsonSerializer.Serialize(Token);
    var apiOriginJson = JsonSerializer.Serialize(apiOrigin);
    await web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync($@"
      (() => {{
        const token = {tokenJson};
        const apiOrigin = {apiOriginJson};
        window.__printersHeroTravelerSource = {{ requested: false, status: null, error: null }};
        const originalFetch = window.fetch.bind(window);
        window.fetch = (input, init = {{}}) => {{
          const requestUrl = typeof input === 'string' ? new URL(input, window.location.href) : new URL(input.url);
          if (requestUrl.origin === apiOrigin && requestUrl.pathname.startsWith('/api/local-bridge/direct-print/jobs/')) {{
            window.__printersHeroTravelerSource.requested = true;
            const headers = new Headers(init.headers || (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined));
            headers.set('Authorization', 'Bearer ' + token);
            return originalFetch(input, {{ ...init, headers }}).then((response) => {{
              window.__printersHeroTravelerSource.status = response.status;
              return response;
            }}).catch((error) => {{
              window.__printersHeroTravelerSource.error = String(error).slice(0, 200);
              throw error;
            }});
          }}
          return originalFetch(input, init);
        }};
      }})();");

    int? sourceStatus = null;
    web.CoreWebView2.WebResourceResponseReceived += (_, e) => {
      if (Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var requestUri) && string.Equals(requestUri.GetLeftPart(UriPartial.Authority), apiOrigin, StringComparison.OrdinalIgnoreCase) && requestUri.AbsolutePath.StartsWith("/api/local-bridge/direct-print/jobs/", StringComparison.OrdinalIgnoreCase)) { sourceStatus = e.Response.StatusCode; Log($"Direct-print source response: {sourceStatus}."); }
    };
    var ready = new TaskCompletionSource();
    web.CoreWebView2.NavigationCompleted += (_, e) => { if (e.IsSuccess) { Log($"Traveler navigation succeeded: {travelerUri.Host}."); ready.TrySetResult(); } else { Log($"Traveler navigation failed: {travelerUri.Host} ({e.WebErrorStatus})."); ready.TrySetException(new InvalidOperationException("Traveler render navigation failed.")); } };
    var additionalFeedMm = NormalizeAdditionalTrailingFeedMm(job.trailingFeedMm);
    var effectiveFeedMm = BaseTravelerTrailingFeedMm + additionalFeedMm;
    var separator = travelerUri.Query.Length > 0 ? "&" : "?";
    var route = UsesClaimedDocument(job.documentType) ? travelerUri.ToString() : $"{travelerUri}{separator}printNote={Uri.EscapeDataString(job.printNote ?? "")}&feedMm={additionalFeedMm.ToString("0.##", CultureInfo.InvariantCulture)}";
    Log($"Traveler navigation host: {travelerUri.Host}.");
    Log($"Traveler navigation started: {travelerUri.Host}.");
    web.CoreWebView2.Navigate(route);
    await ready.Task.WaitAsync(TimeSpan.FromSeconds(30));
    if (UsesClaimedDocument(job.documentType)) await WaitForShippingRender(web, job);
    else await WaitForTravelerRender(web, () => sourceStatus);
    await web.ExecuteScriptAsync("document.fonts ? document.fonts.ready : Promise.resolve()");
    var renderedHeightJson = await web.ExecuteScriptAsync("(() => Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)))()");
    var renderedHeight = JsonSerializer.Deserialize<double>(renderedHeightJson);
    Log($"Additional trailing feed: {additionalFeedMm.ToString("0.##", CultureInfo.InvariantCulture)} mm.");
    Log($"Effective trailing feed: {effectiveFeedMm.ToString("0.##", CultureInfo.InvariantCulture)} mm.");
    Log($"Rendered ticket height: {renderedHeight.ToString("0.##", CultureInfo.InvariantCulture)} px.");
    var settings = web.CoreWebView2.Environment.CreatePrintSettings();
    settings.PrinterName = job.queueName;
    settings.Copies = job.copies;
    settings.ShouldPrintBackgrounds = true;
    settings.ShouldPrintHeaderAndFooter = false;
    if (job.documentType == "production_item_label") {
      ApplyProductionLabelMedia(settings, job);
    }
    else if (job.documentType == "ups_label" || job.documentType == "profile_test" && job.printContext is JsonElement context
      && context.TryGetProperty("mediaKind", out var kind) && kind.GetString() == "label") {
      settings.MediaSize = CoreWebView2PrintMediaSize.Custom;
      settings.Orientation = CoreWebView2PrintOrientation.Portrait;
      settings.PageWidth = 4;
      settings.PageHeight = 6;
      settings.MarginTop = settings.MarginRight = settings.MarginBottom = settings.MarginLeft = 0;
    }
    else if (job.documentType == "profile_test" && job.printContext is JsonElement receiptContext
      && receiptContext.TryGetProperty("mediaKind", out var receiptKind) && receiptKind.GetString() == "receipt"
      && receiptContext.TryGetProperty("receiptWidthMm", out var widthElement) && widthElement.TryGetDouble(out var receiptWidthMm)) {
      settings.MediaSize = CoreWebView2PrintMediaSize.Custom;
      settings.PageWidth = Math.Clamp(receiptWidthMm, 40, 120) / 25.4;
      settings.PageHeight = 6;
      settings.MarginTop = settings.MarginRight = settings.MarginBottom = settings.MarginLeft = 0;
    }
    Log("WebView2 PrintAsync submitted.");
    var status = await web.CoreWebView2.PrintAsync(settings);
    Log($"WebView2 print status: {status}.");
    if (status != CoreWebView2PrintStatus.Succeeded) throw new InvalidOperationException($"WebView2 print failed: {status}");
  }
  static void ApplyProductionLabelMedia(CoreWebView2PrintSettings settings, Claim job) {
    if (job.printContext is not JsonElement context || !context.TryGetProperty("document", out var document)
      || !document.TryGetProperty("media", out var media)
      || !media.TryGetProperty("widthMm", out var widthElement) || !widthElement.TryGetDouble(out var width)
      || !media.TryGetProperty("heightMm", out var heightElement) || !heightElement.TryGetDouble(out var height)
      || !double.IsFinite(width) || !double.IsFinite(height) || width < 40 || width > 120 || height < 20 || height > 160)
      throw new InvalidOperationException("The claimed production label size is invalid. Preview again.");

    var printer = new PrinterSettings { PrinterName = job.queueName! };
    bool Matches(PaperSize paper) => Math.Abs(paper.Width * 0.254 - width) <= 0.75
      && Math.Abs(paper.Height * 0.254 - height) <= 0.75;
    if (!printer.IsValid || (!Matches(printer.DefaultPageSettings.PaperSize) && !printer.PaperSizes.Cast<PaperSize>().Any(Matches)))
      throw new InvalidOperationException($"Windows queue '{job.queueName}' does not report {width:0.##} × {height:0.##} mm media. Add or select the matching form in the Windows driver, or use Browser Print.");

    settings.MediaSize = CoreWebView2PrintMediaSize.Custom;
    settings.Orientation = CoreWebView2PrintOrientation.Portrait;
    settings.PageWidth = width / 25.4;
    settings.PageHeight = height / 25.4;
    settings.ScaleFactor = 1;
    settings.MarginTop = settings.MarginRight = settings.MarginBottom = settings.MarginLeft = 0;
  }
  static decimal NormalizeAdditionalTrailingFeedMm(decimal value) => Math.Clamp(value, 0m, MaxAdditionalTrailingFeedMm);
  static async Task WaitForShippingRender(WebView2 web, Claim job) {
    var id = JsonSerializer.Serialize(job.id);
    var type = JsonSerializer.Serialize(job.documentType);
    var deadline = DateTime.UtcNow.AddSeconds(30);
    while (DateTime.UtcNow < deadline) {
      var state = await web.ExecuteScriptAsync($"(()=>{{const el=document.querySelector('[data-print-job-id]');if(!el)return 'loading';if(el.dataset.printJobId!=={id}||el.dataset.printDocumentType&&el.dataset.printDocumentType!=={type})return 'mismatch';if(el.dataset.printError==='true')return 'error:'+String(el.dataset.printErrorMessage||'Shipping document unavailable').replace(/[\\r\\n]/g,' ').slice(0,240);return el.dataset.printReady==='true'&&el.dataset.printDocumentType==={type}?'ready':'loading';}})()");
      var value = JsonSerializer.Deserialize<string>(state);
      if (value == "ready") { Log("Shipping document job/type-bound ready marker reached."); return; }
      if (value?.StartsWith("error:", StringComparison.Ordinal) == true) throw new InvalidOperationException(value[6..]);
      if (value is "error" or "mismatch") throw new InvalidOperationException($"Shipping document render failed: {value}.");
      await Task.Delay(100);
    }
    throw new InvalidOperationException("Shipping document pages and assets did not finish rendering.");
  }
  static async Task WaitForTravelerRender(WebView2 web, Func<int?> sourceStatus) {
    var deadline = DateTime.UtcNow.AddSeconds(30);
    while (DateTime.UtcNow < deadline) {
      var rendered = await web.ExecuteScriptAsync("Boolean(document.querySelector('[data-traveler-ready=\\\"true\\\"]'))");
      if (rendered.Contains("true", StringComparison.OrdinalIgnoreCase)) { Log("Traveler ready marker reached."); return; }
      await Task.Delay(100);
    }
    var pageStateJson = await web.ExecuteScriptAsync("JSON.stringify({ failedLoad: Boolean(document.body && document.body.innerText.includes('Failed to load order traveler.')), loading: Boolean(document.body && document.body.innerText.includes('Loading order traveler...')), documentReadyState: document.readyState, rootChildren: document.getElementById('root')?.childElementCount ?? 0, source: window.__printersHeroTravelerSource ?? null })");
    var pageStateText = JsonSerializer.Deserialize<string>(pageStateJson) ?? "{}";
    using var pageState = JsonDocument.Parse(pageStateText);
    var failedLoad = pageState.RootElement.TryGetProperty("failedLoad", out var failedLoadValue) && failedLoadValue.GetBoolean();
    var loading = pageState.RootElement.TryGetProperty("loading", out var loadingValue) && loadingValue.GetBoolean();
    var documentReadyState = pageState.RootElement.TryGetProperty("documentReadyState", out var documentReadyStateValue) ? documentReadyStateValue.GetString() : "unknown";
    var rootChildren = pageState.RootElement.TryGetProperty("rootChildren", out var rootChildrenValue) && rootChildrenValue.TryGetInt32(out var rootChildCount) ? rootChildCount : -1;
    var sourceDetail = sourceStatus()?.ToString() ?? "not observed";
    if (pageState.RootElement.TryGetProperty("source", out var sourceValue) && sourceValue.ValueKind == JsonValueKind.Object) {
      var requested = sourceValue.TryGetProperty("requested", out var requestedValue) && requestedValue.GetBoolean();
      if (sourceValue.TryGetProperty("status", out var sourceStatusValue) && sourceStatusValue.ValueKind == JsonValueKind.Number) sourceDetail = sourceStatusValue.GetInt32().ToString();
      else if (sourceValue.TryGetProperty("error", out var sourceErrorValue) && sourceErrorValue.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(sourceErrorValue.GetString())) sourceDetail = $"browser error: {sourceErrorValue.GetString()}";
      else if (requested) sourceDetail = "requested without response";
      else sourceDetail = "not requested by page";
    }
    throw new InvalidOperationException($"Traveler content did not finish rendering (source request: {sourceDetail}; page state: {(failedLoad ? "failed" : loading ? "loading" : "not rendered")}; document: {documentReadyState}; root children: {rootChildren}).");
  }
  static async Task<T?> Get<T>(string path) { var r = await Http.GetAsync(BaseUrl + path); r.EnsureSuccessStatusCode(); using var d = JsonDocument.Parse(await r.Content.ReadAsStringAsync()); return d.RootElement.GetProperty("data").Deserialize<T>(JsonOptions); }
  static async Task Post(string path, object body) => await Post<object>(path, body);
  static async Task<T?> Post<T>(string path, object body) { var r = await Http.PostAsJsonAsync(BaseUrl + path, body); r.EnsureSuccessStatusCode(); using var d = JsonDocument.Parse(await r.Content.ReadAsStringAsync()); return d.RootElement.TryGetProperty("data", out var value) ? value.Deserialize<T>(JsonOptions) : default; }
}
