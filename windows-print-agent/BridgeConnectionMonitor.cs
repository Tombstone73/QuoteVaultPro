namespace PrintersHero.PrintAgent;

// Local supervision only; no idle print polling and no retry of claimed jobs.
public sealed class BridgeConnectionMonitor
{
  private readonly object gate = new();
  private DateTimeOffset? unavailableSince;
  private bool joinedBefore;
  public bool OnJoined()
  {
    lock (gate) {
    unavailableSince = null;
    var catchUp = joinedBefore;
    joinedBefore = true;
    return catchUp;
    }
  }
  public bool NeedsRestart(bool ready, DateTimeOffset now)
  {
    lock (gate) {
    if (ready) { unavailableSince = null; return false; }
    unavailableSince ??= now;
    return now - unavailableSince >= TimeSpan.FromSeconds(60);
    }
  }
}
