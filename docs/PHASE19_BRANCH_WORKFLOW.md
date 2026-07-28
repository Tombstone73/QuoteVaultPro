# Phase 19 branch workflow

- `main` is the production branch. It receives validated operational fixes and
  feature work only after DEV validation.
- `dev` is the deployed operational-validation branch. Use it for bug-fix and
  integration validation; do not continuously land unfinished Phase 19 work
  there.
- `feature/ai-product-builder` is the long-running Phase 19 branch. Stage 19K
  and later AI product-builder work belongs there. Periodically merge `main`
  into it normally. Promote it to `dev` only at meaningful validation
  milestones and to `main` only after DEV validation.

Do not independently implement equivalent feature commits on `main` and
`dev`. Equivalent branch-specific fixes need not have matching commit hashes.
Commit only meaningful milestones.
