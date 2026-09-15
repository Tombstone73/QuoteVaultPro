using PrintersHero.PrintAgent;
using Supabase.Realtime;

static void Require(bool condition, string message)
{
  if (!condition) throw new InvalidOperationException(message);
}

var publishableKey = "sb_publishable_contract_test";
var baseEndpoint = RealtimeConnectionConfiguration.GetRealtimeBaseEndpoint("https://example.supabase.co");
var options = RealtimeConnectionConfiguration.CreateClientOptions(publishableKey);

Require(baseEndpoint == "wss://example.supabase.co/realtime/v1", "The application must pass the Realtime base endpoint to the SDK.");
Require(!baseEndpoint.Contains("/websocket", StringComparison.OrdinalIgnoreCase), "The application must not append /websocket.");
Require(!baseEndpoint.Contains("apikey=", StringComparison.OrdinalIgnoreCase), "The application must not append an API-key query parameter.");
Require(!baseEndpoint.Contains("vsn=", StringComparison.OrdinalIgnoreCase), "The application must not append the Realtime protocol version.");
Require(options.Parameters.ApiKey == publishableKey, "ClientOptions.Parameters.ApiKey must receive the publishable key.");
Require(!options.Headers.ContainsKey("Authorization"), "The publishable key must not be sent as bearer authorization.");

var socket = new RealtimeSocket(baseEndpoint, options);
try
{
  var endpointProperty = socket.GetType().GetProperty("EndpointUrl", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
  var endpointUrl = endpointProperty?.GetValue(socket) as string;
  Require(endpointUrl is not null, "Supabase.Realtime 7.4.0 must expose the constructed socket endpoint.");
  var sdkEndpoint = new Uri(endpointUrl!);
  Require(sdkEndpoint.AbsolutePath == "/realtime/v1/websocket", "Supabase.Realtime must add /websocket itself.");
  var query = System.Web.HttpUtility.ParseQueryString(sdkEndpoint.Query);
  Require(query["apikey"] == publishableKey, "Supabase.Realtime must emit the API key from ClientOptions.Parameters.ApiKey.");
  Require(query["vsn"] == "1.0.0", "Supabase.Realtime must emit its protocol version.");
}
finally
{
  try { socket.Disconnect(System.Net.WebSockets.WebSocketCloseStatus.NormalClosure, "contract complete"); }
  catch { }
}

Console.WriteLine("Supabase Realtime 7.4.0 endpoint/options contract passed.");

var postedStaWork = new Queue<Func<Task>>();
var firstDrainStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
var releaseFirstDrain = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
var drainCount = 0;
var concurrentDrains = 0;
var maxConcurrentDrains = 0;
var scheduler = new StaQueueDrainScheduler(
  operation => { postedStaWork.Enqueue(operation); return true; },
  async _ => {
    var concurrent = Interlocked.Increment(ref concurrentDrains);
    maxConcurrentDrains = Math.Max(maxConcurrentDrains, concurrent);
    var count = Interlocked.Increment(ref drainCount);
    if (count == 1) {
      firstDrainStarted.TrySetResult();
      await releaseFirstDrain.Task;
    }
    Interlocked.Decrement(ref concurrentDrains);
  },
  _ => { });

var startupCatchup = scheduler.Request("realtime startup catch-up");
var duplicateWake = scheduler.Request("realtime queue_changed wake");
Require(postedStaWork.Count == 1, "Startup and duplicate wakes must post only one STA drain.");
var staDrain = postedStaWork.Dequeue().Invoke();
await firstDrainStarted.Task;
var reconnectWake = scheduler.Request("realtime reconnect catch-up");
Require(postedStaWork.Count == 0, "A wake during an active drain must be coalesced instead of posted concurrently.");
releaseFirstDrain.TrySetResult();
await staDrain;
await Task.WhenAll(startupCatchup, duplicateWake, reconnectWake);
Require(drainCount == 2, "A wake during an active drain must cause exactly one follow-up drain.");
Require(maxConcurrentDrains == 1, "No two Traveler queue drains may run concurrently.");

var unavailableDrainCalled = false;
var unavailableScheduler = new StaQueueDrainScheduler(_ => false, _ => { unavailableDrainCalled = true; return Task.CompletedTask; }, _ => { });
await AssertFails(unavailableScheduler.Request("dispatcher unavailable"));
Require(!unavailableDrainCalled, "An unavailable STA dispatcher must not claim or drain jobs.");

Console.WriteLine("Traveler STA dispatch/coalescing contract passed.");

static async Task AssertFails(Task task)
{
  try { await task; }
  catch (InvalidOperationException) { return; }
  throw new InvalidOperationException("Expected task failure.");
}
