using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Web.WebView2.Core;
using System.Drawing.Printing;

namespace PrintersHero.PrintAgent;
record Job(string id, string orderId, int copies, string? printNote, decimal trailingFeedMm, string? queueName, string? destinationName, string? location);
record Claim(string id, string orderId, int copies, string? printNote, decimal trailingFeedMm, string? travelerUrl, string? queueName);
static class Program {
  static readonly string BaseUrl = (Environment.GetEnvironmentVariable("PRINTERSHERO_API_BASE_URL") ?? "").TrimEnd('/');
  static readonly string Token = Environment.GetEnvironmentVariable("PRINTERSHERO_AGENT_TOKEN") ?? "";
  static readonly HttpClient Http = new();
  [STAThread] static async Task Main() { if (string.IsNullOrWhiteSpace(BaseUrl) || string.IsNullOrWhiteSpace(Token)) throw new InvalidOperationException("PRINTERSHERO_API_BASE_URL and PRINTERSHERO_AGENT_TOKEN are required."); Http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token); ApplicationConfiguration.Initialize(); using var timer = new System.Windows.Forms.Timer { Interval = 15000 }; timer.Tick += async (_,_) => await Tick(); timer.Start(); await Tick(); Application.Run(new ApplicationContext()); }
  static async Task Tick() { try { await Post("/api/local-bridge/heartbeat", new { name = Environment.MachineName, agentVersion = "1.0.0" }); foreach (var job in await Get<List<Job>>("/api/local-bridge/direct-print/jobs") ?? []) await Print(job); } catch (Exception ex) { Console.Error.WriteLine(ex.Message); } }
  static async Task Print(Job job) { Claim? claim; try { claim = await Post<Claim>($"/api/local-bridge/direct-print/jobs/{job.id}/claim", new { }); } catch { return; } if (claim is null || string.IsNullOrWhiteSpace(claim.queueName) || !QueueExists(claim.queueName)) { await Post($"/api/local-bridge/direct-print/jobs/{job.id}/failed", new { error = "Mapped Windows printer is unavailable." }); return; } try { await PrintTraveler(claim); await Post($"/api/local-bridge/direct-print/jobs/{job.id}/submitted", new { }); } catch (Exception ex) { await Post($"/api/local-bridge/direct-print/jobs/{job.id}/failed", new { error = ex.Message }); } }
  // The Windows spooler is queried locally; the server never accepts a queue
  // supplied by an operator. Status failures still fail closed at PrintAsync.
  static bool QueueExists(string queue) => PrinterSettings.InstalledPrinters.Cast<string>().Any(name => string.Equals(name, queue, StringComparison.OrdinalIgnoreCase));
  static async Task PrintTraveler(Claim job) { using var form = new Form { Width = 1, Height = 1, ShowInTaskbar = false, Opacity = 0 }; using var web = new WebView2 { Dock = DockStyle.Fill }; form.Controls.Add(web); form.Show(); await web.EnsureCoreWebView2Async(); web.CoreWebView2.AddWebResourceRequestedFilter($"{BaseUrl}/*", CoreWebView2WebResourceContext.All); web.CoreWebView2.WebResourceRequested += (_, e) => { e.Request.Headers.SetHeader("Authorization", $"Bearer {Token}"); }; var ready = new TaskCompletionSource(); web.CoreWebView2.NavigationCompleted += (_, e) => { if (e.IsSuccess) ready.TrySetResult(); else ready.TrySetException(new InvalidOperationException("Traveler render navigation failed.")); }; var route = $"{BaseUrl}/orders/{job.orderId}/traveler?printNote={Uri.EscapeDataString(job.printNote ?? "")}&feedMm={job.trailingFeedMm}"; web.CoreWebView2.Navigate(route); await ready.Task.WaitAsync(TimeSpan.FromSeconds(30)); await web.ExecuteScriptAsync("document.fonts ? document.fonts.ready : Promise.resolve()"); var settings = web.CoreWebView2.Environment.CreatePrintSettings(); settings.PrinterName = job.queueName; settings.Copies = job.copies; settings.ShouldPrintBackgrounds = true; settings.ShouldPrintHeaderAndFooter = false; var status = await web.CoreWebView2.PrintAsync(settings); if (status != CoreWebView2PrintStatus.Succeeded) throw new InvalidOperationException($"WebView2 print failed: {status}"); }
  static async Task<T?> Get<T>(string path) { var r = await Http.GetAsync(BaseUrl + path); r.EnsureSuccessStatusCode(); using var d = JsonDocument.Parse(await r.Content.ReadAsStringAsync()); return d.RootElement.GetProperty("data").Deserialize<T>(); }
  static async Task Post(string path, object body) => await Post<object>(path, body);
  static async Task<T?> Post<T>(string path, object body) { var r = await Http.PostAsJsonAsync(BaseUrl + path, body); r.EnsureSuccessStatusCode(); using var d = JsonDocument.Parse(await r.Content.ReadAsStringAsync()); return d.RootElement.TryGetProperty("data", out var value) ? value.Deserialize<T>() : default; }
}
