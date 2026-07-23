# PrintersHero Local Bridge Agent

Runs inside a shop network and only makes outbound HTTPS requests to TitanOS. It never receives cloud storage credentials.

Set `TITANOS_API_BASE_URL`, `TITANOS_BRIDGE_TOKEN`, `BRIDGE_NAME`, and optionally `POLL_INTERVAL_SECONDS`. The agent polls assigned jobs, downloads only bridge-scoped files, writes them beneath the server-provided destination, and reports success or failure.

For Windows, run `node agent.mjs` from an administrator-approved folder with access to the desired local or mapped network path. Do not run it as a user with broader share access than required.
