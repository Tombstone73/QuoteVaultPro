using Supabase.Realtime;
using Supabase.Realtime.Socket;

namespace PrintersHero.PrintAgent;

/// <summary>
/// Builds the input passed to Supabase.Realtime 7.4.0. The SDK owns the
/// websocket path and connection query string; callers must provide only the
/// Realtime base endpoint and the publishable key socket parameter.
/// </summary>
public static class RealtimeConnectionConfiguration
{
  public static string GetRealtimeBaseEndpoint(string supabaseUrl)
  {
    if (!Uri.TryCreate(supabaseUrl, UriKind.Absolute, out var origin)
      || origin.Scheme != Uri.UriSchemeHttps
      || !string.IsNullOrEmpty(origin.Query)
      || !string.IsNullOrEmpty(origin.Fragment))
    {
      throw new InvalidOperationException("PRINTERSHERO_SUPABASE_URL must be an HTTPS origin.");
    }

    var builder = new UriBuilder(origin)
    {
      Scheme = Uri.UriSchemeWss,
      Path = "/realtime/v1",
      Query = string.Empty,
      Fragment = string.Empty,
    };
    return builder.Uri.AbsoluteUri.TrimEnd('/');
  }

  public static ClientOptions CreateClientOptions(string publishableKey)
  {
    if (string.IsNullOrWhiteSpace(publishableKey))
    {
      throw new InvalidOperationException("PRINTERSHERO_SUPABASE_PUBLISHABLE_KEY is required.");
    }

    return new ClientOptions
    {
      Parameters = new SocketOptionsParameters
      {
        ApiKey = publishableKey,
      },
    };
  }
}
