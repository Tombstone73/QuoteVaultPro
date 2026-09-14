PrintersHero Traveler Print Agent

1. Extract this complete folder to a stable local location.
2. Create a Local Bridge / Print Agent pairing token in PrintersHero Settings.
3. Double-click setup-agent.cmd.
4. Approve the one-time Windows administrator prompt for the signed-in Windows
   user. It creates the startup task. If it fails, the Administrator setup
   window shows the error and stays open.
5. If prompted, install Microsoft Edge WebView2 Runtime from the official
   Microsoft page, then run setup again.
6. Choose the Traveler printer from the list, then paste the pairing token.
   Production setup uses https://api.printershero.com (not the web-app URL).
7. When every setup check shows [OK], print one test Traveler in PrintersHero.

For diagnostics run: setup-agent.ps1 -Check
For removal run:     setup-agent.ps1 -Uninstall

See README.md for troubleshooting and release-build details.
