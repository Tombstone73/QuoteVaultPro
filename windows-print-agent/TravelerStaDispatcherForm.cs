namespace PrintersHero.PrintAgent;

/// <summary>
/// Owns the single WinForms message pump and Win32 handle used to marshal all
/// Traveler rendering onto the agent's STA thread.
/// </summary>
public sealed class TravelerStaDispatcherForm : Form
{
  public TravelerStaDispatcherForm()
  {
    ShowInTaskbar = false;
    FormBorderStyle = FormBorderStyle.None;
    Opacity = 0;
    Width = 1;
    Height = 1;
    StartPosition = FormStartPosition.Manual;
    Location = new System.Drawing.Point(-32_000, -32_000);
  }
}
