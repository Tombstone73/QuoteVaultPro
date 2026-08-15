import type { BusinessRequestId, OrderId, OrganizationId, ProductTypeId, SalesLineId } from "../shared/commercialValues.js";

export type CreateRouteForWorkItemInput = Readonly<{
  organizationId: OrganizationId;
  orderId: OrderId;
  salesLineId: SalesLineId;
  productTypeId: ProductTypeId;
  routeTemplateRevisionId: string;
  businessRequestId: BusinessRequestId;
}>;
export type CreateRouteForWorkItemResult = Readonly<{ routeInstanceId: string; routeTemplateRevisionId: string }>;
export interface RoutingPort { createRouteForWorkItem(input: CreateRouteForWorkItemInput): Promise<CreateRouteForWorkItemResult>; }
