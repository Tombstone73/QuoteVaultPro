import { z } from "zod";
import { assistantSafeIdentifierSchema, type AssistantSourceLink } from "@shared/assistantContracts";
import { buildOrderReadinessLights, orderActionNeededLines, type OrderReadinessLightsInput } from "@shared/orderReadinessLights";
import { orderProofStatusValues } from "@shared/orderProofStatus";
import { hasAdminOrOwnerOperationalRole } from "@shared/roleAccess";
import { orderFulfillmentReadinessReadResultSchema, readOrderFulfillmentReadiness } from "./orderFulfillmentReadinessRead";
import type { AssistantToolAdapter } from "./toolRegistry";

export const currentReadinessInput = z.object({ view: z.enum(["operational", "fulfillment"]).default("operational") }).strict();
const count = z.number().int().nonnegative();
const summarySchema = z.object({
  totalItems: count, productionRequiredCount: count, actionNeededCount: count, inProgressCount: count,
  proof: z.object({ status: z.enum(orderProofStatusValues), label: z.string(), lineItemId: assistantSafeIdentifierSchema.nullable(), openProofingAvailable: z.boolean() }).strict(),
}).strict();
export const currentReadinessResult = z.discriminatedUnion("view", [
  z.object({ view: z.literal("operational"), orderNumber: z.string(), summary: summarySchema,
    actionLines: z.array(z.object({ lineItemId: assistantSafeIdentifierSchema, state: z.string(), inspect: z.string(), href: z.string(),
      correctionEligibility: z.literal("not_supplied") }).strict()).max(25),
    omittedActionLines: count, guidance: z.string(), proofNavigation: z.string().nullable(),
    proofSource: z.enum(["native", "ui_fallback"]), proofOverrideRoleAllowed: z.boolean().nullable(),
  }).strict(),
  z.object({ view: z.literal("fulfillment"), orderNumber: z.string(), fulfillment: orderFulfillmentReadinessReadResultSchema }).strict(),
]);

type NativeLine = NonNullable<OrderReadinessLightsInput["lineItems"]>[number] & { id: string };
type ReadOrder = (organizationId: string, orderId: string) => Promise<(OrderReadinessLightsInput & {
  id: string; displayNumber: string | null; orderNumber: string; lineItems: readonly NativeLine[];
}) | undefined>;

/** Text for the non-generative result card; never infer an overall verdict. */
export function describeCurrentReadiness(raw: unknown): string {
  const data = currentReadinessResult.parse(raw);
  if (data.view === "fulfillment") {
    const f = data.fulfillment;
    if (f.status !== "available") return "Fulfillment readiness is unavailable.";
    return `Order ${data.orderNumber}: ${f.nativeStatus}. ${f.quantities.readyWaitingQuantity} ready and waiting; ${f.quantities.notReadyQuantity} not ready. Checklist: ${f.checklist.checked}/${f.checklist.total} checked. ` +
      (f.operationAuthority.canConfirmPhysicalReadiness === undefined ? "Permission to confirm physical readiness was not supplied." : f.operationAuthority.canConfirmPhysicalReadiness ? "Your role permits confirming physical readiness in Fulfillment; the operation still validates the quantities." : "Your role does not permit confirming physical readiness.");
  }
  const { summary } = data;
  const actions = summary.actionNeededCount ? `${summary.actionNeededCount} action needed` : "No immediate action needed";
  const first = data.actionLines[0];
  const proof = data.proofSource === "native" ? summary.proof.label : `Proof evidence unavailable (screen fallback: ${summary.proof.label})`;
  return `Order ${data.orderNumber}: ${actions}. ${proof}. ${summary.inProgressCount} in progress.` +
    (first ? ` ${first.inspect} (${first.state}).` : "") + " The Operational Summary does not certify production or fulfillment readiness.";
}

export function createCurrentOrderReadinessTool(
  readOrder: ReadOrder = async (org, id) => (await import("../../storage")).storage.getOrderById(org, id),
  readFulfillment = readOrderFulfillmentReadiness,
): AssistantToolAdapter {
  return { async execute(raw, { scope, actor, context }) {
    const { view } = currentReadinessInput.parse(raw);
    if (context.entityType !== "order" || !context.entityId) return { status: "not_found", data: null, warning: "Open an order to read its readiness indicators." };
    const order = await readOrder(scope.organizationId, context.entityId);
    if (!order || order.id !== context.entityId) return { status: "not_found", data: null };
    const orderNumber = order.displayNumber ?? order.orderNumber;
    const sourceLinks: AssistantSourceLink[] = [{ label: `Order ${orderNumber}`, href: `/orders/${encodeURIComponent(order.id)}`, entityType: "order", entityId: order.id }];
    let data: z.infer<typeof currentReadinessResult>;
    if (view === "fulfillment") {
      const fulfillment = await readFulfillment({ ...scope, orderId: order.id });
      if (fulfillment.status === "omitted") {
        if (fulfillment.reason === "native_authority_unverified") return { status: "permission_denied", data: null, warning: "Current fulfillment access could not be verified." };
        return { status: "failed", data: null, warning: "Native fulfillment readiness could not be retrieved. No readiness conclusion is available." };
      }
      sourceLinks.push({ label: "Open Fulfillment", href: fulfillment.navigation.fulfillment });
      data = { view, orderNumber, fulfillment };
    } else {
      const summary = buildOrderReadinessLights(order);
      const destinations: Record<string, [string, string]> = {
        needs_design: ["Review the design queue", "/production/design"],
        ready_for_prepress: ["Review the prepress queue", "/production/prepress"],
        ready_for_production: ["Review the production board", "/production"],
      };
      const actionLines = orderActionNeededLines(order.lineItems).slice(0, 25).map(({ line, state }) => {
        const [inspect, href] = destinations[state] ?? ["Inspect Line Items; the summary gives no specific cause", sourceLinks[0].href];
        return { lineItemId: line.id, state, inspect, href, correctionEligibility: "not_supplied" as const };
      });
      const proofNavigation = summary.proof.openProofingAvailable && summary.proof.lineItemId
        ? `/production/proofing?${new URLSearchParams({ lineItemId: summary.proof.lineItemId, slice: "all" })}` : null;
      if (proofNavigation) sourceLinks.push({ label: "Open Proofing", href: proofNavigation });
      data = { view, orderNumber, summary, actionLines, omittedActionLines: summary.actionNeededCount - actionLines.length, proofNavigation,
        proofSource: order.proofStatus && order.proofStatusLabel ? "native" : "ui_fallback",
        proofOverrideRoleAllowed: proofNavigation && actor.organizationRole ? hasAdminOrOwnerOperationalRole(actor.organizationRole) : null,
        guidance: "Inspect Line Items on the order for the listed workflow states. The Operational Summary has no single production-ready verdict, underlying cause, or per-line correction eligibility. A proof link opens the internal proofing workspace; it is not permission to approve or override a proof." };
    }
    return { status: "succeeded", data: currentReadinessResult.parse(data), provenance: { sourceLinks, freshness: { capturedAt: new Date().toISOString() } } };
  } };
}
