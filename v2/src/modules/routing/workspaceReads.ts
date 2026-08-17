import type { RouteInstanceState, RouteStepKind } from "./contracts.js";

/** Bounded, read-only Routing projection. Position remains owned by Routing. */
export type RoutingWorkspaceRead = Readonly<{
  templates: readonly Readonly<{
    routeTemplateId: string; name: string; active: boolean; revision: string;
    definitionFingerprint: string; steps: readonly Readonly<{ position: number; kind: RouteStepKind }>[];
  }>[];
  instances: readonly Readonly<{
    routeInstanceId: string; state: RouteInstanceState; currentStepId?: string;
    sourceTemplate: Readonly<{ routeTemplateId: string; revision: string; definitionFingerprint: string }>;
    orderId: string; orderNumber: string; orderLineId: string; lineDescription: string;
    steps: readonly Readonly<{ routeInstanceStepId: string; position: number; kind: RouteStepKind }>[];
  }>[];
}>;

export interface RoutingWorkspaceReadPort {
  workspace(organizationId: string): Promise<RoutingWorkspaceRead>;
}
