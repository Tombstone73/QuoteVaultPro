export type OwnerRouteScope = Readonly<{ organizationId: string; orderId: string; orderLineId: string }>;
export type ProductionDestination = "flatbed" | "roll";
export type SalesWorkflowRouteRequest = OwnerRouteScope & (
  | Readonly<{ kind: "direct_production"; destination: ProductionDestination }>
  | Readonly<{ kind: "production_not_required" }>
);
export type PreparedPrepressResult<T> =
  | Readonly<{ kind: "rework"; value: T }>
  | Readonly<{ kind: "ordinary"; createWork: () => Promise<T> }>;

/** Internal owner operations participate in the caller's existing transaction.
 * Readiness and exception evidence remain with their authoritative owners. */
export interface OwnerTransitions {
  handoffPreparedPrepress<T>(request: OwnerRouteScope, prepare: (destination: ProductionDestination) => Promise<PreparedPrepressResult<T>>): Promise<{ destination: ProductionDestination; value: T }>;
  applySalesWorkflowException(request: SalesWorkflowRouteRequest, recordException: () => Promise<void>): Promise<void>;
  inspectSalesWorkflowRoute(request: OwnerRouteScope): Promise<{ fulfillmentEligible: boolean; directProductionDestination?: ProductionDestination }>;
}
