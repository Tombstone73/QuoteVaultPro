# AI modernization: Milestone 1

## Delivered foundation

This release repairs existing adapters and shares existing extraction. It adds no
provider, service activation, database migration, mutation endpoint, or parallel
business parser. Existing tenant settings continue selecting the provider/model.

### Provider compatibility

`providerCapabilities.ts` now resolves validated descriptors with aliases rather
than using one exact model as the gate for every special capability. Unknown
models and unofficial endpoints do not acquire provider-specific capabilities.

Verified against official DeepSeek documentation on 2026-11-03:

- [Vision](https://api-docs.deepseek.com/guides/vision/): `deepseek-flash`
  accepts image input; the retired `deepseek-v4-flash-vision-exp` alias is served
  by current Flash. Legacy `deepseek-v4-flash` is not assumed to have vision.
- [Responses](https://api-docs.deepseek.com/guides/responses_api/): Flash and
  V4 Pro support Responses/functions. Native web search is Pro-only; the previous
  Flash-only search assumption was incorrect.
- [Thinking](https://api-docs.deepseek.com/guides/thinking_mode/): bounded task
  reasoning is supported. Inbound extraction and iterative Operator decisions use
  low effort; simple JSON tasks retain the existing fast default. Reasoning and
  continuation remain ephemeral and are not audit/user content.

Unsupported image models fail explicitly before sending bytes. No model setting
is automatically changed and no live provider invocation was used for validation.

### Document evidence and interpretation

The existing PDF text/form/geometry reader is extracted to `pdfDocumentText.ts`
and shared by inbound and Assistant attachment extraction. The existing PDF page
renderer is reused for scans and forms, with the existing four-page visual batch
and twenty-page document limits. Quarantined/rejected inbound files are never read.

`attachments.inspect` supports explicit additional page numbers. Its existing
conversation/user/tenant file resolver remains authoritative. Provider image
bytes live on an ephemeral Symbol property; JSON/audit/browser projections do not
contain them. Every result identifies page coverage. Uninspected inbound pages
remain an explicit review decision using existing acknowledgment contracts.

PO summaries and date inference now fill gaps instead of replacing populated
interpretations. Complete interpreted line items are not rebuilt from reference
attachment regexes. Original source summaries are retained, not rewritten from
AI output. Disagreements remain visible alongside confidence and provenance;
actual source-source conflict and stale evidence guards remain unchanged.
Offset House regression facts are exercised through synthetic form PDFs and
provider fixtures, not a new document-specific parser. Customer PO totals remain
separate from canonical PBV2 prices.

### Public research

Existing `web.search` / `web.open` tools remain the only public egress path.
Provider-native search is not enabled because it cannot enforce the server's
per-query private-data check. Research availability reflects the existing public
search configuration, not advertised native provider support. No service or key
is activated by this release.

Queries and URLs are checked for sensitive identifiers and server-released private
customer/financial facts. Local PBV2 prices are compared after public research,
not sent to public search. Public results retain source URLs, retrieval timestamps
and unauthenticated access classification. DNS pinning, redirect revalidation,
private-network restrictions and response limits remain enforced. Untrusted
external content cannot grant permissions, GO, or access to authenticated prices.

### Canonical capabilities and approval

Existing `application.capabilities`, `application.operations`, and
`application.prepare_change` already provide the reusable foundation. No duplicate
business tools were introduced. Current canonical registry contains 24 read tools
and 44 commands (the earlier audit counted 43). Customer/product/pricing discovery
is permission-filtered; existing preparation delegates to canonical adapters.
Execution remains separate, bound to actor/tenant, exact proposal, versions,
confirmation token, idempotency and canonical validation. Missing adapters stay
explicit gaps; discovery never grants execution authority.

## Validation and limits

Focused provider, PDF rendering/extraction, inbound, public research, capability,
and confirmation/version/idempotency tests use isolated fixtures. Static checks
are scoped to changed files with the 8192 MB Node heap. No persistence contract
changed; no PostgreSQL migration or database test was required. No production
records, workers, tenant settings, provider credentials or deployment settings
were changed. DEV/MAIN deployment and configured-provider quality remain separate
acceptance checks. The optional actual Offset House file test requires a supplied
local source path; fixture results do not prove production-document interpretation.

## Next milestone

Evaluate the configured provider with authorized representative documents and
public research tasks, then incrementally add missing conversational preparation
adapters over canonical operations. Preserve the current approval boundary and
measure field retention, coverage, latency and recovery before broadening adapters.
