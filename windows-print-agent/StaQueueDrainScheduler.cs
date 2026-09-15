namespace PrintersHero.PrintAgent;

/// <summary>
/// Coalesces durable queue wake signals and runs each drain through the caller's
/// designated STA dispatcher. The scheduler deliberately knows nothing about
/// WinForms so its coalescing and shutdown behaviour can be regression tested.
/// </summary>
public sealed class StaQueueDrainScheduler
{
  private readonly object gate = new();
  private readonly Func<Func<Task>, bool> dispatchToSta;
  private readonly Func<string, Task> drain;
  private readonly Action<string> log;
  private bool requested;
  private bool posted;
  private bool running;
  private bool shuttingDown;
  private string latestReason = "queue wake";
  private TaskCompletionSource? completion;

  public StaQueueDrainScheduler(Func<Func<Task>, bool> dispatchToSta, Func<string, Task> drain, Action<string> log)
  {
    this.dispatchToSta = dispatchToSta;
    this.drain = drain;
    this.log = log;
  }

  public Task Request(string reason)
  {
    TaskCompletionSource requestCompletion;
    var shouldPost = false;
    lock (gate)
    {
      if (shuttingDown) return Task.FromException(new InvalidOperationException("The Traveler STA dispatcher is shutting down."));

      requested = true;
      latestReason = reason;
      completion ??= new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
      requestCompletion = completion;
      if (!running && !posted)
      {
        posted = true;
        shouldPost = true;
      }
    }

    if (shouldPost && !dispatchToSta(RunOnStaAsync))
    {
      const string error = "Traveler STA dispatcher is unavailable; queued work was not claimed.";
      lock (gate)
      {
        posted = false;
        requested = false;
        if (ReferenceEquals(completion, requestCompletion)) completion = null;
      }
      log(error);
      requestCompletion.TrySetException(new InvalidOperationException(error));
    }

    return requestCompletion.Task;
  }

  public void Shutdown()
  {
    TaskCompletionSource? pending;
    lock (gate)
    {
      shuttingDown = true;
      requested = false;
      pending = completion;
      completion = null;
    }
    pending?.TrySetException(new OperationCanceledException("The Traveler STA dispatcher is shutting down."));
  }

  private async Task RunOnStaAsync()
  {
    while (true)
    {
      string reason;
      lock (gate)
      {
        if (shuttingDown) return;
        posted = false;
        running = true;
        requested = false;
        reason = latestReason;
      }

      try
      {
        await drain(reason);
      }
      catch (Exception ex)
      {
        log($"Queue drain failed ({reason}): {ex.Message}");
      }

      TaskCompletionSource? completed = null;
      lock (gate)
      {
        if (shuttingDown) return;
        if (requested) continue;
        running = false;
        completed = completion;
        completion = null;
      }
      completed?.TrySetResult();
      return;
    }
  }
}
