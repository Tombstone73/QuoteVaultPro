# Inbound form-PO evidence preservation

## Confirmed regression

The local original of Offset House PO 26-109691 was inspected read-only as text, AcroForm data, and a rendered page. Its dynamic values are form widgets, while the issuer heading is graphical. The existing PDF.js extraction read only `getTextContent()`. Consequently the model received the static blank-template labels, not most of the order information. This is not evidence that OCR is required.

After recovering form values, the existing text heuristics still produced quantity **25** from the cents in **$718.25**, product **Prints**, and requested date **2026-11-02** rather than the in-hands date **2026-11-10**. Applying those hints after AI interpretation would overwrite correct fields. Arbitrary form names also cannot identify business meaning: this PO's `Company Name` field contains a pickup instruction, while the recipient is the supplier.

| Information | Loss point and correction |
| --- | --- |
| Offset House | Graphical issuer absent from text; bounded page images reach the existing vision-capable provider input. Prompt distinguishes issuer, supplier and ship-to. Canonical customer matching and staff confirmation remain in place. |
| 26-109691 | Form value omitted; widgets now join page evidence with page/layout attribution. |
| All Sport Hard Hat Stickers | Form description omitted, then heuristic could replace it with Prints; interpreted form summaries now use structured model fields rather than rerunning table regexes. |
| Quantity 5300 | Form value omitted; flat text heuristic could extract 25 from the price; form raw text no longer feeds that heuristic. The model sees both the requested quantity and explicit instruction correcting the reference template. |
| 4 x 1.5 inches | Form value omitted and generic dimension hints miss this quoted layout; existing AI width/height/unit fields survive normal validation and shared-editor hydration. |
| 4/0 white permanent adhesive vinyl | Form text omitted; recovered source text feeds existing material and option fields. |
| Contour cut, shrink-wrap in 100s | Form text omitted; existing finishing fields and source text retain unsupported/unmapped instructions for review. |
| Customer pickup | Form value omitted and a company-label trap; AI requestedPickup and ship-method fields hydrate the ordinary fulfillment controls. |
| November 10, 2026 EOD | Static labels and separate values lost their relationship; page/layout interpretation distinguishes order date from in-hands date. Date uses the existing due-date contract; EOD instruction remains in notes. |
| $718.25 | Form value omitted; table total not recognized by labeled-price regex; prompt/schema now retain an independent source total in integer cents. Existing pricing review compares it with PBV2 for a single line. No override is authorized automatically. Multi-line document totals remain in notes and are never assigned to every line. |

## Boundaries

- PDF.js remains the canonical inbound text extractor. Text-only PDFs retain their previous extraction behavior. Filled text widgets are extracted with page coordinates, independently of field creation order/names.
- Form PO pages reuse `renderAssistantPdfPages` and the configured provider's existing image contract. At most four form pages per evidence bundle are supplied. Existing stage deadlines, file authorization and quarantine guards remain. Visual failures/coverage limits produce warnings; original evidence stays available.
- Image bytes remain ephemeral provider input. Stored parsed drafts contain evidence attribution and interpreted fields, never base64 images.
- Existing PO summary/reconciliation contracts are reused. A single interpreted line can populate the existing form-PO summary; multiple lines or multiple POs are not flattened into one summary.
- Catalog search remains tenant scoped and active, now joins the product's ACTIVE PBV2 version and searches its tree metadata alongside names, descriptions and existing synonyms/specifications. An AI parsing description is not a prerequisite. Multiple strong candidates require staff confirmation. Previously saved catalog selections retain existing compatibility.
- No database migration, persistence writer, ownership model, approval gate, worker activation, or customer/order mutation is introduced. Saved staff drafts remain authoritative; obtaining corrected suggestions requires deliberate Retry Parse and explicit draft reconciliation. Existing edits are not automatically refreshed.

## Validation and limits

Focused parsing/evidence tests exercise actual PDF.js text/form extraction and existing rendering, including the original local PO when `OFFSET_PO_REGRESSION_PDF` is explicitly set. Synthetic form fixtures cover different field creation order and misleading field names. Existing tests cover other PO layouts, collapsed text, email/PO conflicts, cancellation, late results, manual recovery, staff preservation and canonical conversion guards.

Focused draft tests verify selected active product, quantity/size/specifications/pickup/deadline hydration, independent source versus PBV2 prices, no automatic override, ambiguous product confirmation, multi-line totals, and mocked snapshot readback. SQL construction is exercised through the actual repository method with a query adapter fixture. These are not PostgreSQL or deployed readback claims; no persistence operation changed.

The original MAIN parse attempt/raw provider output and the live tenant catalog were not accessed. Configured-provider interpretation is not established by fixture responses. Actual extraction/rendering is verified separately; live provider interpretation, CRM/catalog matching, and persisted DEV readback remain acceptance checks. The original customer document is not committed to the repository.
