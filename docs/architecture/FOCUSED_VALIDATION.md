# TitanOS focused validation

Run these commands from the repository root after installing the lockfile's dependencies with `npm ci`.

```sh
npm run validate:types -- orders
npm run validate:tests -- orders
npm run validate:tests -- all --list
npm run --silent validate:types -- orders quotes shared/orderDeadline.ts --json --list-files
```

Use more than one lane when a change crosses domain boundaries. For a refactor, include both sides of the move, affected callers, any new modules not yet imported, and the changed test files as explicit TypeScript inputs. `all` combines the six focused lanes. The exact roots and suites are maintained in the [lane manifest](../../scripts/validation/lanes.mjs).

## Lanes

| Lane | TypeScript entry points | Selected runtime and source contracts | Examples of coverage to add when affected |
| --- | --- | --- | --- |
| `orders` | Order routes and status-pill catalog | Status-pill service, closed guards, filter, Express catalog contract, Order mutation wiring | Persisted order transitions, status seeding, reconciliation, and concurrency |
| `quotes` | Quote routes, email routes, canonical Quote operations | Quote normalization, quote email HTTP contract, and conversion transaction wiring | Draft persistence, quote approval and conversion under real transactions, provider delivery |
| `pricing` | Formula routes and canonical PricingService | Base-price and PBV2 matrix cases, preview validation, and source contract for Order child pricing | Formula-route HTTP behavior, real product data, pricing snapshot persistence |
| `billing` | Invoicing, grouped Stripe, payment provider routes, canonical Invoice and Payment operations | Invoice release, EPS, and staff and portal checkout eligibility HTTP contracts | Stripe or QuickBooks settlement, invoice writes and cross-transaction reconciliation |
| `production` | Production jobs and runs, fulfillment and bulk fulfillment routes | Production ownership, production run completion source contract, pickup history and route fixture | Real production handoffs, carrier operations, parcel persistence and bulk rollback |
| `frontend` | Status-pill selector and hook, workspace context | jsdom component behavior, query cache behavior, and ESM workspace navigation | Other pages and hooks, bundler behavior, real browser, device and portal acceptance |

When adding a suite, review its setup and dependencies for database access. The focused Jest runner first verifies that every requested path is discoverable using the existing Jest config, then runs the exact paths serially. `--list` only runs discovery. Server/shared tests use the root Jest transform, client tests use jsdom, and `.esm.test.*` client suites use the ESM client config. The runner narrows Jest roots to the relevant source directories and stores its cache under ignored `node_modules/.cache`, so adjacent worktrees and reference projects cannot pollute discovery.

The ordinary lanes replace the application database URLs with an unreachable loopback placeholder and clear `TEST_DATABASE_URL`. They suppress dotenv autoload for these runs so an application `.env` cannot opt them into a database. HTTP contract tests may bind a local ephemeral Express port. Source contracts read application wiring and assert structure. Source contracts alone do not establish effective HTTP behavior.

### Open pricing correctness issue

M3.2 repaired the incomplete pricing matrix fixtures, the invalid selection expectation, and the payment and fulfillment test contracts. Two quantity-only tests remain ordinary failing tests. The complete pricing lane returns exit 1:

```sh
npm run validate:tests -- pricing
```

The failures are `qty_only preview uses direct matrix base_price for economy without quantity tiers` and `qty_only preview uses direct matrix base_price for deluxe without quantity tiers` in [PricingService.pricingMatrix.test.ts](../../server/services/pricing/tests/PricingService.pricingMatrix.test.ts). To reproduce just the two cases with the original Jest configuration, run the following in PowerShell from the repository root:

```powershell
$env:NODE_OPTIONS = '--max-old-space-size=8192 --experimental-vm-modules'
$env:DOTENV_CONFIG_PATH = 'NUL'
$env:TEST_DATABASE_URL = ''
$env:DATABASE_URL = 'postgresql://validation:validation@127.0.0.1:1/validation_test'
$env:DIRECT_DATABASE_URL = $env:DATABASE_URL
$env:MIGRATION_DATABASE_URL = $env:DATABASE_URL
node node_modules/jest/bin/jest.js --config jest.config.js --runInBand --roots server shared --cacheDirectory node_modules/.cache/jest-validation --runTestsByPath server/services/pricing/tests/PricingService.pricingMatrix.test.ts -t 'qty_only preview uses direct matrix base_price'
```

The fixtures price one piece at 1 × 1 with the `qty_only` profile, all scalar rates set to zero, no quantity tiers, and matrix `base_price` values of 7500 cents for `3mm` (economy) and 15000 cents for `6mm` (deluxe). The submitted formula is `q * base_price`. Expected totals are $75 and $150. Preview returns $0 in both cases. M3.1 confirmed in memory that the canonical publish validator accepts an equivalent structurally valid draft without errors or warnings, while the preview uses a zero per-piece rate.

An accepted configuration can therefore show a misleading zero preview. The line pricing guard can reject saving a zero total for qualifying non-dimensional products unless they opted into zero pricing. A real tenant's exposure and persisted Quote or Order effects are unverified. Resolve the compatibility contract for matrix-only quantity pricing separately across publish, preview, and line pricing.

## TypeScript diagnostics and coverage

The focused compiler uses the installed TypeScript version and root compiler options, including its existing strictness, module resolution, aliases and implicit target. It disables incremental state and adds Jest test globals, Passport's Express augmentation, and the root project's ambient declarations. TypeScript resolves and checks the imports and literal dynamic imports from all selected sources and tests. `--list-files` shows the whole resolved program. With `--json`, the report includes the roots, declarations, diagnostics and optional file list. Use it to check for a critical dependency if coverage is in doubt.

Nonliteral imports, callers that do not appear in the forward dependency graph, unrelated code and separate TS projects may fall outside a lane. A new route file is only in scope once it is selected or imported. The lanes do not establish full-repo coverage, and changing a shared type or boundary can justify a broader check. The shared server dependency graph is large, so server lanes can overlap heavily. Combining them in one invocation checks the graph once.

Both `npm run validate:types` and the full root `npm run check` use an 8 GB Node heap. Full `check` retains the root project includes and excludes. Root `check` excludes `**/*.test.ts` by default, while a focused lane adds its selected tests as explicit inputs. The separate V2, Playwright and financial integrity projects use their own TS configs. For direct `tsc -p` or `v2:check` invocations set `NODE_OPTIONS=--max-old-space-size=8192` in the shell or via the existing `cross-env`.

The [diagnostic snapshot](../../scripts/validation/typescript-baseline.json) records the six-lane union against application source at `011c66ef4`, with TypeScript 5.6.3. The command in that file reproduces the comparison. Baseline identity uses the repository-relative path, diagnostic code, category, full message, source line text and column. A line number shift alone does not change identity. Duplicate diagnostics consume separate baseline entries. Every diagnostic is printed and errors of either status cause exit 1. A focused run need not encounter every baseline entry. An unmatched diagnostic needs review, even when it appears outside the edited files. Update the snapshot only after reviewing the difference against a known source commit and toolchain.

M3 captured 57 existing diagnostics under the root options. They include 37 TS2802 iteration diagnostics, 13 TS1378 top-level-await diagnostics, four TS7006 implicit-any diagnostics, and one each of TS1501, TS2322 and TS2345. The root config's implicit target accounts for many of them. A compiler-target migration is separate work.

### M1 reference

The original M1 profile used the root compiler options with `incremental: false`, `target: ES2022` and `types: ['node', 'jest']`. To reproduce it with the TypeScript compiler API, load the root config with `getParsedCommandLineOfConfigFile`, pass those option overrides to `createProgram` with only `server/routes/orders.routes.ts`, `server/routes/orderStatusPillCatalog.routes.ts` and `server/tests/orderStatusPillCatalog.routes.test.ts` as roots, and print `getPreEmitDiagnostics(program)`. Use the same 8 GB heap. All ten diagnostics were TS2339, "Property 'user' does not exist on type 'Request<ParamsDictionary, any, any, ParsedQs, Record<string, any>>'."

| File | Lines at `011c66ef4` |
| --- | --- |
| `server/services/developerPortalImpersonationService.ts` | 81, 96, 129 |
| `server/services/staffPortalPreviewService.ts` | 83, 163, 260 |
| `server/tenantContext.ts` | 69, 291, 433, 449 |

The M3 runner includes the Express augmentation from Passport explicitly. That provides the `user` property that was missing from the M1 program while keeping those source files in scope.

## PostgreSQL integration

```sh
npm run validate:postgres -- schema-push
npm run validate:postgres -- migrations
npm run validate:postgres -- legacy
```

These commands report actual Jest discovery and make no database connections. Pick the fixture profile required by the chosen test. The configurations overlap and make different assumptions about schema preparation.

| Profile | Selection and execution |
| --- | --- |
| `schema-push` | `jest.local-postgres.config.js` discovers `.postgres.integration.ts` suites and uses the local driver and a prepared ORM schema with test setup additions. See the [disposable PostgreSQL procedure](../payment-disposable-postgres-tests.md) for a verified-target setup example. Execute an explicit test path with this config after checking its schema requirements. |
| `migrations` | `jest.inbound-postgres.config.js` allowlists suites for a dedicated loopback cluster and real migration run. This includes the legacy-named quote routing/conversion contract and storefront checkout suite. Use [the isolated runner](../inbound-email-postgres-validation.md), passing `-TestPaths` for the suites you intend to execute. |
| `legacy` | Lists the [identified database suites](../../scripts/validation/legacy-postgres.mjs) that still match the broad root config, regardless of suffix. This inventory is curated. Some suites manage their own readiness or seeding, so inspect their setup before running a specific suite with a disposable fixture. |

The original broad `npm test` remains available. Its root config has mixed discovery and may run database setup when configured, so it is not a unit-only command. A `.test.ts`, `.integration.test.ts` or `.contract.test.ts` suffix cannot determine database requirements. Check the discovery profiles and fixture setup before counting a suite as either ordinary or PostgreSQL coverage. Keep new ordinary suites explicit and give new PostgreSQL suites a dedicated name and fixture configuration.

## Other validation paths

- **Frontend test suite:** `npm run test:client` uses client Jest in jsdom. Use `client/jest.esm.config.js` separately for client ESM suites. `npm run test:e2e` uses Playwright for real browser flows against the configured target.
- **Full build:** `npm run build` builds the Vite frontend, bundles the Express backend with esbuild, and copies runtime assets. It is separate from TypeScript checking.
- **CI:** The AI Operator drift workflow still runs build, targeted Jest checks, knowledge validation and generated-file drift checks. The migration integrity workflow still runs the journal and integrity preflight. The new lanes are local commands and do not replace those workflow steps.
- **Deployment:** The platform's deployment workflow and checks remain separate. A focused result does not establish deployment or live acceptance.
