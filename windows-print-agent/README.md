# PrintersHero Windows Traveler Print Agent

This is the shop-side, outbound-only agent for **Traveler** tickets. It runs
in the logged-in Windows session because Edge WebView2 and Windows printer
drivers must use that session. It never listens on the LAN and the cloud never
opens a connection to the workstation.

The agent claims a tenant-scoped job, loads the existing PrintersHero Traveler
page with that claimed-job credential, waits for the React Traveler to finish
rendering, and asks Windows to spool it to the mapped queue. `submitted` means
Windows accepted the spool request; it cannot guarantee paper physically left
the Epson.

## Shop workstation setup

No Visual Studio, .NET runtime installation, source editing, or manual task
creation is required.

1. Download and extract the `PrintersHero-Traveler-Print-Agent-win-x64.zip`
   release package to a stable local folder.
2. In PrintersHero Settings, create a Local Bridge / Print Agent pairing token.
   Copy it; it is shown only once.
3. Double-click `setup-agent.cmd` (or right-click `setup-agent.ps1` and choose
   **Run with PowerShell**).
4. Approve the one-time Windows administrator prompt for the signed-in Windows
   user. It creates the startup task; no manual Task Scheduler work is needed.
   If it fails, the Administrator setup window stays open and shows the exact
   error.
5. If needed, accept the prompt to open the official Microsoft WebView2
   Runtime installer page. Install it, then run setup again.
6. Choose the installed Epson TM-L90 Windows queue from the numbered list,
   then paste the pairing token when prompted. USB and IP-installed queues
   work the same way. The production API defaults to
   `https://api.printershero.com`; do not substitute the web-app URL.
7. Setup registers that queue only for the paired agent, installs and starts
   the per-user logon task, and shows an `[OK]` checklist. The token is never
   shown again or written to agent logs.
8. In PrintersHero, use **Print Traveler** for one test ticket. **Open Browser
   Print** remains available as a fallback.

The release is a **self-contained win-x64** build. It includes the required
.NET runtime files; WebView2 remains the only workstation prerequisite.

### Diagnostics and removal

```powershell
.\setup-agent.ps1 -Check
.\setup-agent.ps1 -Uninstall
.\setup-agent.ps1 -Uninstall -RemoveConfiguration
```

`-Check` verifies WebView2, the selected local queue, agent executable,
configuration presence, startup task, process, and a safe PrintersHero
heartbeat. It never prints the pairing token. Uninstall does not revoke the
server-side pairing credential.

The logon task is intentional instead of a Windows Session 0 service: the
Epson driver and WebView2 print integration must run in the logged-in user's
session. The underlying task script still supports `install`, `start`, `stop`,
`restart`, `status`, and `uninstall` for diagnostics.

## Development and release build

For development, normal `dotnet build` remains available. To create the shop
package on a build machine with the .NET 8 SDK:

```powershell
.\scripts\build-release.ps1
```

This runs the `Shop-win-x64` publish profile with `SelfContained=true`, writes
the distributable folder to `release\PrintersHero-Traveler-Print-Agent\`, and
creates `release\PrintersHero-Traveler-Print-Agent-win-x64.zip`. The package
contains no tokens or machine-specific printer names.

## Troubleshooting

- `Mapped Windows printer is unavailable`: the local Epson queue does not
  exist or its name differs from the queue selected during setup.
- A claimed job that is not acknowledged remains claimed rather than being
  retried automatically. This intentionally avoids a duplicate physical
  Traveler after a crash; make a new explicit Print Traveler request if needed.
- Ensure the API URL has no path suffix and uses HTTPS in production.
- Local agent logs are at `%LOCALAPPDATA%\PrintersHero\print-agent.log`; they
  contain job ids and printer names, never the bridge credential or document.
- Do not copy the bridge token into tickets, logs, or source control. Revoke
  and recreate the agent in Settings if it is exposed.
