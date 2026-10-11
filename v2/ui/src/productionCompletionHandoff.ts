import type { OrderRead, ProductionWorkProjection } from "./api";

type Route = OrderRead["routes"][number];
export type ProductionCompletionPorts = Readonly<{
  complete: (organizationId: string, attemptId: string, requestId: string) => Promise<unknown>;
  readWork: (organizationId: string, workId: string) => Promise<ProductionWorkProjection>;
  readOrder: (organizationId: string, orderId: string) => Promise<Readonly<{
    order: Pick<OrderRead["order"], "organizationId" | "orderId">;
    routes: OrderRead["routes"];
    completionEligibility: Readonly<{ lines: readonly Pick<OrderRead["completionEligibility"]["lines"][number], "orderLineId" | "workflowIntent" | "productionRequired" | "productionComplete" | "routeRequired">[] }>;
  }>>;
  advance: (organizationId: string, routeId: string, requestId: string, revision: string) => Promise<unknown>;
}>;

/** Coordinates existing owner operations; Routing alone decides whether a step may advance. */
export async function completeProductionAndHandoff(ports: ProductionCompletionPorts, input: Readonly<{
  organizationId: string; workId: string; attemptId: string; canAdvanceRouting: boolean;
}>): Promise<string> {
  // These identities survive a lost response and a page reload without repeating output.
  await ports.complete(input.organizationId, input.attemptId, `production-complete:${input.attemptId}`);
  const work = await ports.readWork(input.organizationId, input.workId);
  if (work.work.productionWorkId !== input.workId) throw new Error("Production completion readback did not match the selected work.");
  if (!work.unitQuantitySatisfied) return "Attempt completed. Required production quantity remains outstanding.";
  if (!input.canAdvanceRouting) return "Production completed. Order view and Routing advance permissions are required for handoff; use the Order's Routing action.";
  const order = await ports.readOrder(input.organizationId, work.work.orderId);
  if (order.order.organizationId !== input.organizationId || order.order.orderId !== work.work.orderId)
    throw new Error("Order handoff readback did not match the completed production work.");
  const lines = order.completionEligibility.lines;
  if (!lines.length || lines.some(line => line.workflowIntent === "unavailable") || new Set(lines.map(line => line.orderLineId)).size !== lines.length || !lines.some(line => line.orderLineId === work.work.orderLineId))
    throw new Error("Order production obligation coverage is unavailable. Review the Order before handoff.");
  const routes = order.routes;
  if (new Set(routes.map(route => route.work.orderLineId)).size !== routes.length || routes.some(route => !lines.some(line => line.orderLineId === route.work.orderLineId))
    || lines.some(line => line.routeRequired && !routes.some(route => route.work.orderLineId === line.orderLineId)))
    throw new Error("Order route coverage is unavailable. Review the Order before handoff.");
  const current = (route: Route) => route.steps.find(step => step.routeInstanceStepId === route.currentStepId);
  if (routes.some(route => route.state !== "completed" && !current(route)))
    throw new Error("Current route-step evidence is unavailable. Review the Order before handoff.");
  if (order.completionEligibility.lines.some(line => line.productionRequired && !line.productionComplete))
    return "Production recorded. The Order remains in production while other required work is outstanding.";
  if (routes.some(route => ["proofing", "prepress"].includes(current(route)?.kind ?? "") || current(route)?.kind === "production" && !route.currentPrerequisite?.satisfied))
    return "Production recorded. The Order remains in production while other required work is outstanding.";
  const production = routes.filter(route => current(route)?.kind === "production");
  if (new Set(production.map(route => route.work.orderLineId)).size !== production.length || production.some(route => !route.routeInstanceId || !route.revision))
    throw new Error("Ambiguous production route ownership. Review the Order before handoff.");
  for (const route of production) {
    await ports.advance(input.organizationId, route.routeInstanceId!,
      `production-handoff:${route.routeInstanceId}:${route.currentStepId}`, route.revision!);
  }
  return production.length ? "All routed production is satisfied. Canonical Routing handoff completed." : "Production completed. No current production route remains to advance.";
}

export type ProductionCompletionIntent = Readonly<{ organizationId: string; sessionScope: string; attemptId: string; workId: string }>;
export type CompletionRecovery = Readonly<{ status: "clear" }> | Readonly<{ status: "blocked" }> | Readonly<{ status: "pending"; intent: ProductionCompletionIntent }>;
const completionKey = (org: string, scope: string) => `ph.v2.production.pending-completion.${org}.${scope}`;
export function readProductionCompletion(org: string, scope: string): CompletionRecovery {
  try {
    const raw = sessionStorage.getItem(completionKey(org, scope));
    if (!raw) return { status: "clear" };
    const value = JSON.parse(raw) as ProductionCompletionIntent;
    if (value.organizationId !== org || value.sessionScope !== scope || typeof value.attemptId !== "string" || !value.attemptId || typeof value.workId !== "string" || !value.workId)
      return { status: "blocked" };
    return { status: "pending", intent: { organizationId: org, sessionScope: scope, attemptId: value.attemptId, workId: value.workId } };
  } catch { return { status: "blocked" }; }
}
export function persistProductionCompletion(intent: ProductionCompletionIntent): boolean {
  try {
    const saved = readProductionCompletion(intent.organizationId, intent.sessionScope);
    if (saved.status === "blocked" || saved.status === "pending" && JSON.stringify(saved.intent) !== JSON.stringify(intent)) return false;
    const raw = JSON.stringify(intent);
    sessionStorage.setItem(completionKey(intent.organizationId, intent.sessionScope), raw);
    return sessionStorage.getItem(completionKey(intent.organizationId, intent.sessionScope)) === raw;
  } catch { return false; }
}
export function clearProductionCompletion(intent: ProductionCompletionIntent): boolean {
  try {
    const saved = readProductionCompletion(intent.organizationId, intent.sessionScope);
    if (saved.status !== "pending" || JSON.stringify(saved.intent) !== JSON.stringify(intent)) return false;
    sessionStorage.removeItem(completionKey(intent.organizationId, intent.sessionScope));
    return sessionStorage.getItem(completionKey(intent.organizationId, intent.sessionScope)) === null;
  } catch { return false; }
}
