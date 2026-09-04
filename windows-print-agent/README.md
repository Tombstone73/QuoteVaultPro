# PrintersHero Windows Print Agent

Runs in the logged-in Windows user's session (not as a Session 0 service) and silently prints Traveler jobs with Edge WebView2. Publish with `dotnet publish -c Release -r win-x64 --self-contained false`; install the resulting folder on the workstation, set `PRINTERSHERO_API_BASE_URL`, `PRINTERSHERO_AGENT_TOKEN`, and add the executable to that user's Startup Apps. The Microsoft Edge WebView2 Evergreen Runtime is required.

The agent only claims jobs assigned to its paired token. It never accepts a queue name or URL from a browser user.
