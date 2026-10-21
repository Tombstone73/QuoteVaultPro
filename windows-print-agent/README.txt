PrintersHero Print Agent 1.0.28

1. Extract this complete folder to a stable local location.
2. Create a Local Bridge / Print Agent pairing token in PrintersHero Settings.
3. Double-click setup-agent.cmd.
4. Approve the one-time Windows administrator prompt for the signed-in Windows
   user. It creates the startup task. If it fails, the Administrator setup
   window shows the error and stays open.
5. If prompted, install Microsoft Edge WebView2 Runtime from the official
   Microsoft page, then run setup again.
6. Choose the initial Traveler Windows printer queue, then paste the pairing
   token. Add other queues as printer profiles in PrintersHero after setup.
   Production setup uses https://api.printershero.com (not the web-app URL).
7. When every setup check shows [OK], create or review printer profiles for
   the reported queues and run Test Print for each intended media type.

The installed task loads the current saved pairing configuration at every
startup, so a successful setup uses the selected token immediately. It uses a
direct Supabase Realtime wake subscription and does not send recurring queue
polls or heartbeats to PrintersHero while idle. Keep the extracted package
folder in its chosen location after setup.

For diagnostics run: setup-agent.ps1 -Check
For removal run:     setup-agent.ps1 -Uninstall

See README.md for troubleshooting and release-build details.

Shipping documents use the same paired agent and a profile's exact Windows queue.
Enable Packing Slip, Shipment Manifest, or Package Ticket on the printer profile
only if its paper is suitable. Agents older than 1.0.25 cannot receive these jobs.
Submitted means accepted by Windows, not confirmed physical printing.
UPS labels require agent 1.0.26 or newer, a shipping-label printer profile,
and a Windows printer driver configured for 4 x 6 inch stock. The agent prints
the GIF through Windows; it does not send ZPL directly.
One paired 1.0.28 installation can serve multiple Windows printer queues. A
pairing token identifies the installation, not each physical printer. To add
a newly installed queue, restart the agent, then map it on the Printers page.
Use scripts\manage-agent-task.ps1 -Action restart to restart the task.
