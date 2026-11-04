using System.Diagnostics;

namespace PrintersHero.PrintAgent;

// Uses the same installed scheduled task. No listener, remote command, or
// second background service is introduced.
public sealed class BridgeTrayController : IDisposable
{
  private readonly NotifyIcon icon;
  private readonly ToolStripMenuItem status = new("Reconnecting");
  private readonly Func<bool> busy;
  private readonly Func<bool> reserveRestart;
  private readonly Action cancelRestart;
  public BridgeTrayController(Func<bool> busy, Func<bool> reserveRestart, Action cancelRestart)
  {
    this.busy = busy; this.reserveRestart = reserveRestart; this.cancelRestart = cancelRestart;
    var menu = new ContextMenuStrip();
    status.Enabled = false;
    menu.Items.Add(status);
    menu.Items.Add("Check bridge status", null, (_, _) => MessageBox.Show(status.Text, "PrintersHero Print Bridge"));
    menu.Items.Add("Restart Bridge Service", null, (_, _) => Restart());
    icon = new NotifyIcon { Icon = SystemIcons.Application, Text = "PrintersHero Print Bridge", ContextMenuStrip = menu, Visible = true };
  }
  public void Update(string text) { status.Text = text; icon.Text = ("PrintersHero · " + text.Split('\n')[0])[..Math.Min(63, ("PrintersHero · " + text.Split('\n')[0]).Length)]; }
  private void Restart()
  {
    if (busy()) { MessageBox.Show("A print job is being processed. Wait for it to finish before restarting. Do not retry a possibly printed job automatically.", "Print Bridge busy"); return; }
    var script = Path.Combine(AppContext.BaseDirectory, "scripts", "manage-agent-task.ps1");
    if (!File.Exists(script)) { MessageBox.Show("Local controller missing. Extract the complete Print Agent package and run setup-agent.cmd. No remote restart was attempted.", "Restart unavailable"); return; }
    if (MessageBox.Show("Restart this workstation's PrintersHero scheduled task? Claimed or submitted jobs will not be printed again automatically.", "Restart Bridge Service", MessageBoxButtons.YesNo) != DialogResult.Yes) return;
    if (!reserveRestart()) { MessageBox.Show("Printing became active. Wait before restarting.", "Print Bridge busy"); return; }
    try {
      var start = new ProcessStartInfo("powershell.exe") { UseShellExecute = false, CreateNoWindow = true };
      foreach (var arg in new[] { "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", script, "-Action", "restart" }) start.ArgumentList.Add(arg);
      Process.Start(start);
    } catch { cancelRestart(); MessageBox.Show("Windows could not launch the local controller. Run scripts\\manage-agent-task.ps1 -Action restart from the installed folder.", "Restart unavailable"); }
  }
  public void Dispose() { icon.Visible = false; icon.ContextMenuStrip?.Dispose(); icon.Dispose(); }
}
