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
