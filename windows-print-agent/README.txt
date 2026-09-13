PrintersHero Traveler Print Agent

1. Extract this complete folder to a stable local location.
2. Create a Local Bridge / Print Agent pairing token in PrintersHero Settings.
3. Double-click setup-agent.cmd.
4. If prompted, install Microsoft Edge WebView2 Runtime from the official
   Microsoft page, then run setup again.
5. Paste the pairing token and choose the Traveler printer from the list.
6. When every setup check shows [OK], print one test Traveler in PrintersHero.

For diagnostics run: setup-agent.ps1 -Check
For removal run:     setup-agent.ps1 -Uninstall

See README.md for troubleshooting and release-build details.
