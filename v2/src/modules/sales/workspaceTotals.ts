import type { OperationContext } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import { assertSalesLineSnapshot, type SalesLineSnapshot } from "./contracts.js";
import { assertSalesWorkspaceMutable, getAuthorizedSalesWorkspace, validateSalesWorkspaceId } from "./workspaceApplication.js";
import type { SalesWorkspace, SalesWorkspaceStore, SalesWorkspaceTransaction } from "./workspaceContracts.js";
import type { SalesWorkspaceLinePricing } from "./workspaceLines.js";
import { workspaceLinePreviewFingerprint } from "./workspaceLines.js";
import type { SalesTaxComposition } from "./taxComposition.js";
import { brandedId, canonicalJson } from "../shared/commercialValues.js";

export type WorkspaceOrderTotals = Readonly<{
  workspaceId: string;
  workspaceRevision: number;
  target: "order";
  currency: string;
  subtotalCents: number;
  tax: Readonly<{ status: "resolved"; taxCents: number; totalCents: number }>
    | Readonly<{ status: "unresolved"; reason: Extract<SalesTaxComposition, { status: "unresolved" }>["reason"]; taxCents: null; totalCents: null }>;
}>;

/** Read-only review of persisted new-Sales evidence. The Pricing and tax owners
 * are injected on the same read transaction; review never refreshes stored lines. */
export async function readWorkspaceOrderTotals(context: OperationContext, workspaceId: string, expectedRevision: number,
  store: SalesWorkspaceStore, owners: (tx: SalesWorkspaceTransaction) => Readonly<{
    pricing: SalesWorkspaceLinePricing;
    taxability(productId: string): Promise<boolean>;
    composeTax(workspace: SalesWorkspace, lines: readonly SalesLineSnapshot[]): Promise<SalesTaxComposition>;
  }>): Promise<WorkspaceOrderTotals> {
  validateSalesWorkspaceId(workspaceId);
  return store.run(async tx => {
    const workspace = await getAuthorizedSalesWorkspace(tx, context, workspaceId);
    assertSalesWorkspaceMutable(workspace, expectedRevision);
    if (workspace.kind !== "new_sales" || workspace.sourceDocumentId || workspace.sourceDocumentKind || workspace.baseRevision) {
      throw new V2ApplicationError("CONFLICT", "Order totals review is only available for new Sales workspaces.");
    }
    if (!new AuthorityPolicy().decide(context.principal, { capability: "order.create", resource: { organizationId: context.organizationId } }).allowed) {
      throw new V2ApplicationError("FORBIDDEN", "Order totals review requires Order creation authority.");
    }
    if (!workspace.header.customerContact || !workspace.lines.length) {
      throw new V2ApplicationError("CONFLICT", "Order totals review requires a customer or contact and at least one line.");
    }
    const ports = owners(tx);
    const lines: SalesLineSnapshot[] = [];
    for (const line of workspace.lines) {
      const preview = line.previews?.order;
      if (!preview || preview.target !== "order" || preview.inputFingerprint !== workspaceLinePreviewFingerprint(line.input, workspace.header.customerContact)
        || canonicalJson(preview.customerContact ?? null) !== canonicalJson(workspace.header.customerContact)) {
        throw new V2ApplicationError("CONFLICT", "Refresh Order pricing before reviewing totals.");
      }
      const fresh = (await ports.pricing.preview(context, workspace.header, line.input)).order;
      // Canonical decisions carry observation time, not a pricing-policy change.
      const { decidedAt: _storedTime, ...storedDecision } = preview.sellingPriceDecision;
      const { decidedAt: _freshTime, ...freshDecision } = fresh?.sellingPriceDecision ?? {};
      if (!fresh || canonicalJson(preview.resolvedConfiguration) !== canonicalJson(fresh.resolvedConfiguration)
        || canonicalJson(preview.pricingResult) !== canonicalJson(fresh.pricingResult)
        || canonicalJson(storedDecision) !== canonicalJson(freshDecision)) {
        throw new V2ApplicationError("CONFLICT", "Product configuration or pricing changed. Refresh Order pricing before reviewing totals.");
      }
      lines.push(assertSalesLineSnapshot({
        lineId: brandedId<"SalesLineId">(line.id), productId: brandedId<"ProductId">(line.input.productId),
        description: line.input.description ?? "", quantity: line.input.quantity,
        resolvedConfiguration: preview.resolvedConfiguration, pricingResult: preview.pricingResult,
        sellingPriceDecision: preview.sellingPriceDecision,
        calculatedLineAmount: preview.pricingResult.calculatedLineAmount,
        sellingLineAmount: preview.sellingPriceDecision.resultingLineAmount,
        taxability: { taxable: await ports.taxability(line.input.productId), source: "product" },
      }));
    }
    const currency = lines[0]!.sellingLineAmount.currency;
    if (lines.some(line => line.sellingLineAmount.currency !== currency)) throw new V2ApplicationError("CONFLICT", "Order line currencies do not match.");
    const subtotalCents = lines.reduce((sum, line) => sum + line.sellingLineAmount.cents, 0);
    if (!Number.isSafeInteger(subtotalCents)) throw new V2ApplicationError("CONFLICT", "Order subtotal exceeds supported whole-cent amounts.");
    const tax = await ports.composeTax(workspace, lines);
    // A concurrent line/header save must not attach old totals to a newer revision.
    assertSalesWorkspaceMutable(await getAuthorizedSalesWorkspace(tx, context, workspaceId), expectedRevision);
    return { workspaceId, workspaceRevision: workspace.revision, target: "order", currency, subtotalCents,
      tax: tax.status === "resolved" ? { status: "resolved", taxCents: tax.taxCents, totalCents: tax.finalTotalCents }
        : { status: "unresolved", reason: tax.reason, taxCents: null, totalCents: null } };
  });
}
