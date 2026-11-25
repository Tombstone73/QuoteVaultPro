# Repository Guidelines

## Development Workflow

Implement the requested change, run focused static checks and relevant tests, and commit meaningful completed work. Unless the task specifies a local-only stopping point, push the validated work to the appropriate DEV branch using a normal, non-force Git push. No separate approval is required for each DEV push. The existing auto-deployment handles the release; do not wait for it or perform live validation unless explicitly requested.

If DEV has advanced, preserve its changes, reconcile actual conflicts, and rerun checks for the affected functionality. Do not repeat unrelated tests, infrastructure audits, or verification of established DEV/MAIN separation by default.

MAIN promotion always requires explicit approval. Never automatically push experimental work to MAIN or use MAIN business records for experimental tests.

## Worktree and Application Boundaries

Keep changes in the assigned worktree. Preserve specialist assignments, non-overlapping file ownership, and the independent read-only reviewer. Keep test data and external effects isolated; do not copy credentials between environments.

PrintersHero owns business rules, permissions, validation, workflow transitions, persistence, and timelines. AI is an interface to the same native operations available to the authenticated user. Preserve existing confirmation and authorization checks and keep native operations independent of AI.
