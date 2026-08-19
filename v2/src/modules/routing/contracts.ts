import type {
  OrganizationId,
  OrderId,
  OrderLineId,
  RouteInstanceId,
  RouteInstanceStepId,
  RouteTemplateId,
  RouteTemplateStepId,
} from "../shared/commercialValues.js";

/** Coarse internal destinations, not Production stations, providers, or execution state. */
export type RouteStepKind = "proofing" | "prepress" | "production" | "fulfillment";
export type RouteInstanceState = "pending" | "active" | "completed";

export type RouteTemplateStep = Readonly<{
  routeTemplateStepId: RouteTemplateStepId;
  position: number;
  kind: RouteStepKind;
}>;

/** Routing owns the ordered definition; Products only owns the default-template reference. */
export type RouteTemplate = Readonly<{
  routeTemplateId: RouteTemplateId;
  organizationId: OrganizationId;
  name: string;
  active: boolean;
  revision: string;
  definitionFingerprint: string;
  steps: readonly RouteTemplateStep[];
}>;

/** The only commercial work Routing accepts in this milestone. Sales validates it in M1.9. */
export type SalesOrderLineWorkReference = Readonly<{
  kind: "sales_order_line";
  organizationId: OrganizationId;
  orderId: OrderId;
  orderLineId: OrderLineId;
}>;

export type RouteInstanceStep = Readonly<{
  routeInstanceStepId: RouteInstanceStepId;
  position: number;
  kind: RouteStepKind;
}>;

/** A frozen route is the Routing-owned internal position for one legitimate work reference. */
export type RouteInstance = Readonly<{
  routeInstanceId: RouteInstanceId;
  organizationId: OrganizationId;
  work: SalesOrderLineWorkReference;
  sourceTemplate: Readonly<{
    routeTemplateId: RouteTemplateId;
    revision: string;
    definitionFingerprint: string;
  }>;
  state: RouteInstanceState;
  currentStepId?: RouteInstanceStepId;
  revision: string;
  steps: readonly RouteInstanceStep[];
}>;

export type InstantiateRouteInput = Readonly<{
  organizationId: OrganizationId;
  work: SalesOrderLineWorkReference;
  routeTemplateId: RouteTemplateId;
}>;

export type InstantiateRouteResult = Readonly<{
  routeInstance: RouteInstance;
  /** False means a concurrent/coordinated caller already instantiated this work item. */
  created: boolean;
}>;

/**
 * Routing is the sole owner of frozen-route position.  The client identifies
 * the current frozen route and its observed revision; it never supplies a
 * destination step or a replacement route definition.
 */
export type CompleteCurrentRouteStepInput = Readonly<{
  businessRequestId: string;
  routeInstanceId: RouteInstanceId;
  expectedRevision: string;
}>;

export type CompleteCurrentRouteStepResult = Readonly<{
  routeInstance: RouteInstance;
  completedStep: RouteInstanceStep;
  nextStep?: RouteInstanceStep;
}>;

/** Products' explicit final policy. V1 routing flags/name inference are intentionally absent. */
/** No generic CRUD: callers resolve, instantiate, and read inside their own transaction. */
export interface RoutingPort {
  resolveRouteTemplate(organizationId: OrganizationId, routeTemplateId: RouteTemplateId): Promise<RouteTemplate | null>;
  instantiateRoute(input: InstantiateRouteInput): Promise<InstantiateRouteResult>;
  readRouteInstance(organizationId: OrganizationId, routeInstanceId: RouteInstanceId): Promise<RouteInstance | null>;
  readRouteForWork(organizationId: OrganizationId, orderLineId: OrderLineId): Promise<RouteInstance | null>;
}

/** Future named operations only; M1.8 deliberately implements none of them. */
export type FutureRoutingOperation =
  | "route.start"
  | "route.advance"
  | "route.reroute"
  | "route.cancel";
