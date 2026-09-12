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

## Workstation setup

1. Install the Epson TM-L90 Windows driver and confirm a browser Traveler
   already prints correctly to it. List the actual queues with
   `PrintersHero.PrintAgent.exe --list-printers` (or Windows `Get-Printer`),
   then note the exact queue name.
2. In PrintersHero Settings, create a Local Bridge agent and copy its one-time
   token. Create a Traveler printer profile mapped to that agent and exact
   Windows queue name. The browser never receives that queue name.
3. Install the Microsoft Edge WebView2 Evergreen Runtime and .NET 8 Desktop
   Runtime on the workstation.
4. Publish this project, copy its publish folder to a stable local path, and
   set these **user** environment variables:

   ```powershell
   dotnet publish -c Release -r win-x64 --self-contained false
   [Environment]::SetEnvironmentVariable('PRINTERSHERO_API_BASE_URL', 'https://www.printershero.com', 'User')
   [Environment]::SetEnvironmentVariable('PRINTERSHERO_AGENT_TOKEN', 'paste-the-one-time-token-here', 'User')
   ```

5. Start a new Windows sign-in session, then install the logon task:

   ```powershell
   .\scripts\manage-agent-task.ps1 -Action install -AgentPath 'C:\PrintersHero\PrintAgent\PrintersHero.PrintAgent.exe'
   .\scripts\manage-agent-task.ps1 -Action start
   ```

6. Confirm Settings shows the agent online, then use **Print Traveler** once.
   The **Open Browser Print** action remains available if the agent is offline.

The task script provides `install`, `start`, `stop`, `restart`, `status`, and
`uninstall`. It uses a per-user logon task instead of a Windows Session 0
service: Session 0 cannot reliably access the user-installed Epson driver or
WebView2 printer integration.

## Troubleshooting

- `Mapped Windows printer is unavailable`: the local Epson queue does not
  exist or its name differs from the Settings printer profile.
- A claimed job that is not acknowledged remains claimed rather than being
  retried automatically. This intentionally avoids a duplicate physical
  Traveler after a crash; make a new explicit Print Traveler request if needed.
- Ensure the API URL has no path suffix and uses HTTPS in production.
- Local agent logs are at `%LOCALAPPDATA%\PrintersHero\print-agent.log`; they
  contain job ids and printer names, never the bridge credential or document.
- Do not copy the bridge token into tickets, logs, or source control. Revoke
  and recreate the agent in Settings if it is exposed.
