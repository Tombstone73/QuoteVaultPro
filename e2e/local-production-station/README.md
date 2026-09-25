# Local production station verification

Run `node e2e/local-production-station/server.mjs`, then open
`http://127.0.0.1:4179/production/flatbed`.

This mounts the real ProductionBoard, Flatbed/Roll views, hooks, and sidebar.
All API responses are fixtures. The server binds loopback, does not load environment
files, has no database connection, and rejects non-GET API requests.

Expected unfiltered Flatbed work: F100, F101, run-1 (RUN-100); badge 3.
F100 intentionally lacks customer, artwork, due date, and material display data.
Expected Roll work: R100; badge 1.

Checked manually in Chrome through browser tools:
- Default In Progress filter is explicit; Show all active work restores all 3 rows.
- Searching kdw gives 0 rows with an explicit search explanation while sidebar stays 3.
- Reload retains the search explanation; Show all active work restores the queue.
- Searching F102 returns its Combined Run container and All 1, without standalone members.
- Unassigned printer shows run-1 and F100, with the 2-of-3 filter explanation.
- F100 renders and can be selected despite missing optional display data.
- Refetch fixture queries and full reload retain the same API/DOM identities.
- Roll renders R100 after clearing its status filter.

Backend eligibility (including exclusion of operationally_complete Orders) is tested
separately in server/tests/productionStationPopulation.test.ts. This browser fixture
validates the API-to-rendering contract; it is not real database or deployed validation.
