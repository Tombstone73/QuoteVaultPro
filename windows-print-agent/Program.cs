using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Web.WebView2.Core;
using System.Drawing.Printing;

namespace PrintersHero.PrintAgent;
record Job(string id, string orderId, int copies, string? printNote, decimal trailingFeedMm, string? queueName, string? destinationName, string? location);
record Claim(string id, string orderId, int copies, string? printNote, decimal trailingFeedMm, string? travelerUrl, string? queueName);
static class Program {
  const string AgentVersion = "1.0.17";
  static readonly string BaseUrl = (Environment.GetEnvironmentVariable("PRINTERSHERO_API_BASE_URL") ?? "").TrimEnd('/');
  static readonly string Token = Environment.GetEnvironmentVariable("PRINTERSHERO_AGENT_TOKEN") ?? "";
  static readonly string TravelerPrinter = (Environment.GetEnvironmentVariable("PRINTERSHERO_TRAVELER_PRINTER") ?? "").Trim();
  static readonly string LogPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PrintersHero", "print-agent.log");
  static readonly HttpClient Http = new();
  static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { NumberHandling = JsonNumberHandling.AllowReadingFromString };
  [STAThread] static void Main(string[] args) {
    if (args.Contains("--list-printers", StringComparer.OrdinalIgnoreCase)) { foreach (var queue in PrinterSettings.InstalledPrinters.Cast<string>()) Console.WriteLine(queue); return; }
    if (string.IsNullOrWhiteSpace(BaseUrl) || string.IsNullOrWhiteSpace(Token) || string.IsNullOrWhiteSpace(TravelerPrinter)) throw new InvalidOperationException("PRINTERSHERO_API_BASE_URL, PRINTERSHERO_AGENT_TOKEN, and PRINTERSHERO_TRAVELER_PRINTER are required.");
    Http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token);
    Log("Agent started.");
    ApplicationConfiguration.Initialize();
    using var timer = new System.Windows.Forms.Timer { Interval = 1 };
    timer.Tick += async (_, _) => {
      // Start only after the WinForms message loop establishes its STA sync
      // context. Stopping the timer avoids overlapping WebView2 print jobs.
      timer.Stop();
      try { await Tick(); }
      finally { timer.Interval = 15000; timer.Start(); }
    };
    timer.Start();
    Application.Run(new ApplicationContext());
  }
  static void Log(string message) { Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!); File.AppendAllText(LogPath, $"{DateTimeOffset.UtcNow:O} {message}{Environment.NewLine}"); }
  static async Task Tick() { try { await Post("/api/local-bridge/heartbeat", new { name = Environment.MachineName, agentVersion = AgentVersion }); foreach (var job in await Get<List<Job>>("/api/local-bridge/direct-print/jobs") ?? []) await Print(job); } catch (Exception ex) { Log($"Poll failure: {ex.Message}"); } }
  static async Task Print(Job job) { Claim? claim; try { claim = await Post<Claim>($"/api/local-bridge/direct-print/jobs/{job.id}/claim", new { }); } catch { return; } if (claim is null || string.IsNullOrWhiteSpace(claim.queueName) || !string.Equals(claim.queueName, TravelerPrinter, StringComparison.OrdinalIgnoreCase) || !QueueExists(claim.queueName)) { Log($"Job {job.id} failed: configured Traveler printer unavailable or mismatched."); await Post($"/api/local-bridge/direct-print/jobs/{job.id}/failed", new { error = "The configured Traveler printer is unavailable or does not match the assigned destination." }); return; } try { Log($"Spooling job {job.id} to {claim.queueName}."); await PrintTraveler(claim); await Post($"/api/local-bridge/direct-print/jobs/{job.id}/submitted", new { }); Log($"Windows accepted job {job.id}."); } catch (Exception ex) { Log($"Job {job.id} failed: {ex.Message}"); await Post($"/api/local-bridge/direct-print/jobs/{job.id}/failed", new { error = ex.Message }); } }
  // The Windows spooler is queried locally; the server never accepts a queue
  // supplied by an operator. Status failures still fail closed at PrintAsync.
  static bool QueueExists(string queue) => PrinterSettings.InstalledPrinters.Cast<string>().Any(name => string.Equals(name, queue, StringComparison.OrdinalIgnoreCase));
  static async Task PrintTraveler(Claim job) {
    using var form = new Form { Width = 1, Height = 1, ShowInTaskbar = false, Opacity = 0 };
    using var web = new WebView2 { Dock = DockStyle.Fill };
    form.Controls.Add(web);
    form.Show();
    await web.EnsureCoreWebView2Async();

    web.CoreWebView2.AddWebResourceRequestedFilter($"{BaseUrl}/*", CoreWebView2WebResourceContext.All);
    web.CoreWebView2.WebResourceRequested += (_, e) => e.Request.Headers.SetHeader("Authorization", $"Bearer {Token}");
    // The existing request interceptor covers page resources. Also patch fetch
    // before React starts so the claimed-job request always carries the bridge
    // credential when the Traveler app loads off-screen.
    var tokenJson = JsonSerializer.Serialize(Token);
    await web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync($@"
      (() => {{
        const token = {tokenJson};
        window.__printersHeroTravelerSource = {{ requested: false, status: null, error: null }};
        const originalFetch = window.fetch.bind(window);
        window.fetch = (input, init = {{}}) => {{
          const requestUrl = typeof input === 'string' ? new URL(input, window.location.href) : new URL(input.url);
          if (requestUrl.pathname.startsWith('/api/local-bridge/direct-print/jobs/')) {{
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
      if (Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var requestUri) && requestUri.AbsolutePath.StartsWith("/api/local-bridge/direct-print/jobs/", StringComparison.OrdinalIgnoreCase)) sourceStatus = e.Response.StatusCode;
    };
    var ready = new TaskCompletionSource();
    web.CoreWebView2.NavigationCompleted += (_, e) => { if (e.IsSuccess) ready.TrySetResult(); else ready.TrySetException(new InvalidOperationException("Traveler render navigation failed.")); };
    var separator = job.travelerUrl?.Contains('?') == true ? "&" : "?";
    var route = $"{BaseUrl}{job.travelerUrl}{separator}printNote={Uri.EscapeDataString(job.printNote ?? "")}&feedMm={job.trailingFeedMm}";
    web.CoreWebView2.Navigate(route);
    await ready.Task.WaitAsync(TimeSpan.FromSeconds(30));
    await WaitForTravelerRender(web, () => sourceStatus);
    await web.ExecuteScriptAsync("document.fonts ? document.fonts.ready : Promise.resolve()");
    var settings = web.CoreWebView2.Environment.CreatePrintSettings();
    settings.PrinterName = job.queueName;
    settings.Copies = job.copies;
    settings.ShouldPrintBackgrounds = true;
    settings.ShouldPrintHeaderAndFooter = false;
    var status = await web.CoreWebView2.PrintAsync(settings);
    if (status != CoreWebView2PrintStatus.Succeeded) throw new InvalidOperationException($"WebView2 print failed: {status}");
  }
  static async Task WaitForTravelerRender(WebView2 web, Func<int?> sourceStatus) {
    var deadline = DateTime.UtcNow.AddSeconds(30);
    while (DateTime.UtcNow < deadline) {
      var rendered = await web.ExecuteScriptAsync("Boolean(document.querySelector('[data-traveler-ready=\\\"true\\\"]'))");
      if (rendered.Contains("true", StringComparison.OrdinalIgnoreCase)) return;
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
