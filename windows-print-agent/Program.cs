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
record Job(string id, string orderId, int copies, string? printNote, decimal trailingFeedMm, string? queueName, string? destinationName, string? location);
record Claim(string id, string orderId, int copies, string? printNote, decimal trailingFeedMm, string? travelerUrl, string? queueName);
sealed class QueueChangedBroadcast : BaseBroadcast { }
static class Program {
  const string AgentVersion = "1.0.22";
  const decimal BaseTravelerTrailingFeedMm = 38.1m;
  const decimal MaxAdditionalTrailingFeedMm = 100m;
  static readonly string BaseUrl = (Environment.GetEnvironmentVariable("PRINTERSHERO_API_BASE_URL") ?? "").TrimEnd('/');
  static readonly string Token = Environment.GetEnvironmentVariable("PRINTERSHERO_AGENT_TOKEN") ?? "";
  static readonly string TravelerPrinter = (Environment.GetEnvironmentVariable("PRINTERSHERO_TRAVELER_PRINTER") ?? "").Trim();
  static readonly string SupabaseUrl = (Environment.GetEnvironmentVariable("PRINTERSHERO_SUPABASE_URL") ?? "").TrimEnd('/');
  static readonly string SupabasePublishableKey = Environment.GetEnvironmentVariable("PRINTERSHERO_SUPABASE_PUBLISHABLE_KEY") ?? "";
  static readonly string LogPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PrintersHero", "print-agent.log");
  static readonly HttpClient Http = new();
  static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { NumberHandling = JsonNumberHandling.AllowReadingFromString };
  static readonly HashSet<string> CanonicalTravelerWebHosts = new(StringComparer.OrdinalIgnoreCase) { "www.printershero.com", "dev.printershero.com" };
  static readonly SemaphoreSlim QueueDrainGate = new(1, 1);
  static int QueueDrainRequested;
  static int RealtimeOpenCount;
  static int RealtimeInitialSubscriptionComplete;
  static int RealtimeReconnectCatchupPending;
  static Client? RealtimeClient;
  [STAThread] static void Main(string[] args) {
    if (args.Contains("--list-printers", StringComparer.OrdinalIgnoreCase)) { foreach (var queue in PrinterSettings.InstalledPrinters.Cast<string>()) Console.WriteLine(queue); return; }
    if (string.IsNullOrWhiteSpace(BaseUrl) || string.IsNullOrWhiteSpace(Token) || string.IsNullOrWhiteSpace(TravelerPrinter) || string.IsNullOrWhiteSpace(SupabaseUrl) || string.IsNullOrWhiteSpace(SupabasePublishableKey)) throw new InvalidOperationException("PRINTERSHERO_API_BASE_URL, PRINTERSHERO_AGENT_TOKEN, PRINTERSHERO_TRAVELER_PRINTER, PRINTERSHERO_SUPABASE_URL, and PRINTERSHERO_SUPABASE_PUBLISHABLE_KEY are required.");
    Http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token);
    Log("Agent started.");
    ApplicationConfiguration.Initialize();
    using var timer = new System.Windows.Forms.Timer { Interval = 1 };
    timer.Tick += async (_, _) => {
      // This is one startup dispatch after WinForms establishes its STA
      // context. It never schedules an API poll or Railway heartbeat.
      timer.Stop();
      try { await StartRealtimeWakeSubscriber(); }
      catch (Exception ex) { Log($"Realtime wake subscriber failed to start: {ex.Message}"); }
    };
    timer.Start();
    Application.Run(new ApplicationContext());
  }
  static void Log(string message) { Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!); File.AppendAllText(LogPath, $"{DateTimeOffset.UtcNow:O} {message}{Environment.NewLine}"); }
  static string GetWakeTopic() {
    var tokenHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Token))).ToLowerInvariant();
    return $"printershero:traveler-wake:{tokenHash}";
  }
  static string GetRealtimeBaseEndpoint() => RealtimeConnectionConfiguration.GetRealtimeBaseEndpoint(SupabaseUrl);
  static async Task StartRealtimeWakeSubscriber() {
    var retryDelaySeconds = 3;
    while (true) {
      try {
        Interlocked.Exchange(ref RealtimeOpenCount, 0);
        Interlocked.Exchange(ref RealtimeInitialSubscriptionComplete, 0);
        Interlocked.Exchange(ref RealtimeReconnectCatchupPending, 0);
        var realtimeBaseEndpoint = GetRealtimeBaseEndpoint();
        Log($"Supabase Realtime endpoint host: {new Uri(realtimeBaseEndpoint).Host}.");
        Log("Supabase publishable key configured: yes.");
        RealtimeClient = new Client(realtimeBaseEndpoint, RealtimeConnectionConfiguration.CreateClientOptions(SupabasePublishableKey));
        RealtimeClient.AddStateChangedHandler((_, state) => {
          switch (state) {
            case Supabase.Realtime.Constants.SocketState.Open:
              var connection = Interlocked.Increment(ref RealtimeOpenCount);
              Log("Supabase Realtime connected.");
              if (connection > 1 && Volatile.Read(ref RealtimeInitialSubscriptionComplete) == 1) {
                Interlocked.Exchange(ref RealtimeReconnectCatchupPending, 1);
              }
              break;
            case Supabase.Realtime.Constants.SocketState.Reconnect:
              Log("Supabase Realtime reconnecting.");
              break;
            case Supabase.Realtime.Constants.SocketState.Close:
            case Supabase.Realtime.Constants.SocketState.Error:
              Log("Supabase Realtime disconnected.");
              break;
          }
        });

        Log("Supabase Realtime connecting.");
        await RealtimeClient.ConnectAsync();
        if (RealtimeClient.Socket is null || !RealtimeClient.Socket.IsConnected) throw new InvalidOperationException("Supabase Realtime did not reach an open socket state.");

        // Supabase.Realtime 7.4.0 requires ConnectAsync to create the socket
        // before Channel/Register/Subscribe. The channel itself automatically
        // rejoins after a later socket reconnect once it has joined successfully.
        var channel = RealtimeClient.Channel(GetWakeTopic());
        channel.AddStateChangedHandler((channelSender, state) => {
          if (state != Supabase.Realtime.Constants.ChannelState.Joined || Volatile.Read(ref RealtimeInitialSubscriptionComplete) != 1) return;
          if (Interlocked.Exchange(ref RealtimeReconnectCatchupPending, 0) == 1) _ = CompleteReconnectCatchup();
        });
        var broadcast = channel.Register<QueueChangedBroadcast>(broadcastSelf: false, broadcastAck: false);
        broadcast.AddBroadcastEventHandler((broadcastSender, response) => {
          if (string.Equals(broadcast.Current()?.Event, "queue_changed", StringComparison.Ordinal)) {
            Log("Realtime queue_changed wake received.");
            _ = RequestQueueDrain("realtime queue_changed wake");
          }
        });
        await channel.Subscribe();
        Volatile.Write(ref RealtimeInitialSubscriptionComplete, 1);
        Log("Supabase Realtime wake subscription established.");
        await RequestQueueDrain("realtime startup catch-up");
        Log("Startup queue catch-up completed.");
        return;
      } catch (Exception ex) {
        RealtimeClient = null;
        Log($"Supabase Realtime startup failed; retrying locally in {retryDelaySeconds} seconds: {ex.Message}");
        await Task.Delay(TimeSpan.FromSeconds(retryDelaySeconds));
        retryDelaySeconds = Math.Min(retryDelaySeconds * 2, 30);
      }
    }
  }
  static async Task CompleteReconnectCatchup() {
    try {
      Log("Supabase Realtime wake subscription restored.");
      await RequestQueueDrain("realtime reconnect catch-up");
      Log("Reconnect queue catch-up completed.");
    } catch (Exception ex) { Log($"Reconnect queue catch-up failed: {ex.Message}"); }
  }
  static async Task RequestQueueDrain(string reason) {
    Interlocked.Exchange(ref QueueDrainRequested, 1);
    if (!await QueueDrainGate.WaitAsync(0)) return;
    try {
      do {
        Interlocked.Exchange(ref QueueDrainRequested, 0);
        await DrainDirectPrintQueue(reason);
      } while (Interlocked.Exchange(ref QueueDrainRequested, 0) == 1);
    } finally { QueueDrainGate.Release(); }
  }
  static async Task DrainDirectPrintQueue(string reason) {
    List<Job>? jobs;
    try {
      jobs = await Get<List<Job>>("/api/local-bridge/direct-print/jobs");
    } catch (Exception ex) {
      Log($"Queue drain failed ({reason}): {ex.Message}");
      return;
    }
    foreach (var job in jobs ?? []) {
      Log($"Queue job discovered: {job.id}.");
      await Print(job);
    }
  }
  static async Task Print(Job job) { Claim? claim; try { claim = await Post<Claim>($"/api/local-bridge/direct-print/jobs/{job.id}/claim", new { }); } catch (Exception ex) { Log($"Job {job.id} claim failed: {ex.Message}"); return; } if (claim is null) return; Log($"Queue job claimed: {job.id}."); if (string.IsNullOrWhiteSpace(claim.queueName) || !string.Equals(claim.queueName, TravelerPrinter, StringComparison.OrdinalIgnoreCase) || !QueueExists(claim.queueName)) { Log($"Job {job.id} failed: configured Traveler printer unavailable or mismatched."); await Post($"/api/local-bridge/direct-print/jobs/{job.id}/failed", new { error = "The configured Traveler printer is unavailable or does not match the assigned destination." }); return; } try { Log($"Spooling job {job.id} to {claim.queueName}."); await PrintTraveler(claim); await Post($"/api/local-bridge/direct-print/jobs/{job.id}/submitted", new { }); Log($"Windows accepted job {job.id}."); } catch (Exception ex) { Log($"Job {job.id} failed: {ex.Message}"); await Post($"/api/local-bridge/direct-print/jobs/{job.id}/failed", new { error = ex.Message }); } }
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
    if (string.IsNullOrWhiteSpace(job.travelerUrl) || !Uri.TryCreate(job.travelerUrl, UriKind.Absolute, out var travelerUri)) throw new InvalidOperationException("PrintersHero did not return an absolute Traveler web URL.");
    if (travelerUri.Scheme != Uri.UriSchemeHttps || !CanonicalTravelerWebHosts.Contains(travelerUri.Host)) throw new InvalidOperationException("PrintersHero returned a noncanonical Traveler web URL.");
    var expectedPath = $"/orders/{Uri.EscapeDataString(job.orderId)}/traveler";
    if (!string.Equals(travelerUri.AbsolutePath, expectedPath, StringComparison.Ordinal) || !string.Equals(GetQueryParameter(travelerUri, "directPrintJobId"), job.id, StringComparison.Ordinal)) throw new InvalidOperationException("PrintersHero returned an invalid Traveler print route.");
    return travelerUri;
  }
  static async Task PrintTraveler(Claim job) {
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
    var route = $"{travelerUri}{separator}printNote={Uri.EscapeDataString(job.printNote ?? "")}&feedMm={additionalFeedMm.ToString("0.##", CultureInfo.InvariantCulture)}";
    Log($"Traveler navigation host: {travelerUri.Host}.");
    Log($"Traveler navigation started: {travelerUri.Host}.");
    web.CoreWebView2.Navigate(route);
    await ready.Task.WaitAsync(TimeSpan.FromSeconds(30));
    await WaitForTravelerRender(web, () => sourceStatus);
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
    Log("WebView2 PrintAsync submitted.");
    var status = await web.CoreWebView2.PrintAsync(settings);
    Log($"WebView2 print status: {status}.");
    if (status != CoreWebView2PrintStatus.Succeeded) throw new InvalidOperationException($"WebView2 print failed: {status}");
  }
  static decimal NormalizeAdditionalTrailingFeedMm(decimal value) => Math.Clamp(value, 0m, MaxAdditionalTrailingFeedMm);
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
