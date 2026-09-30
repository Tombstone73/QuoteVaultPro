# Development Rules

The sole authoritative ownership model is
`docs/architecture/v2/V2_MODULE_OWNERSHIP_BOUNDARIES.md`.
Read the relevant owner, approved decisions, known boundary debt, and unresolved
decisions before changing a business fact. Audit reports are evidence, not authority.
Preserve the repository's existing kernel, domain, and database-safety instructions.

- Identify the authoritative owner and transaction boundary before changing state.
- Fix defects at that owner. Never directly mutate another module's owned state;
  use its owner-controlled public contract or operation for cross-module behavior.
- Reads, explicit projections, immutable snapshots, and lock-only coordination are
  not automatically ownership violations. Establish their source and semantics.
- Known boundary debt is not precedent or architectural permission. Do not expand
  it or weaken a guardrail/debt baseline to accommodate a new violation.
- If ownership is genuinely ambiguous, STOP and surface the business decision.
  Parallel agents must post/request a foreign-domain dependency through their
  coordination channel instead of implementing competing authority.
- UI location does not establish business ownership. Do not recreate pricing,
  status, tax, financial, inventory, production, fulfillment, or shipping rules
  in another layer to satisfy a workflow or make a test pass.
- Preserve historical, issued, and immutable evidence and canonical mutation paths.
- Run `npm run v2:validate` before declaring a V2 change complete. Run applicable
  guarded integration/QA checks separately; report every failure and unrun gate.
- DEV validation precedes MAIN. Never promote to MAIN without explicit human
  approval. Committing, pushing, and deploying also require explicit authorization.

Workflow procedures: `.kilo/skills/printershero-debugging/SKILL.md`,
`printershero-architecture-audit`, `printershero-change-verification`,
`printershero-database-safety`, and `printershero-release-validation` in the same
skills directory. These procedures do not supersede the ownership document.
