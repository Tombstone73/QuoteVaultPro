import { z } from "zod";

export type FulfillmentProductionOverrideLine = {
  lineItemId: string;
  name: string;
  productionRequired: boolean;
  orderedQuantity: number;
  productionCompleteQuantity: number;
  outstandingQuantity: number;
  maximumQuantity: number;
  revision: string;
};

export const fulfillmentProductionOverrideSchema = z.object({
  clientRequestId: z.string().uuid(),
  items: z.array(z.object({
    lineItemId: z.string().min(1).max(128),
    quantity: z.number().int().positive().max(2147483647),
    revision: z.string().length(64),
  }).strict()).min(1).max(500),
}).strict().refine(
  ({ items }) => new Set(items.map(item => item.lineItemId)).size === items.length,
  { message: "Select each order line only once." },
);

export type FulfillmentProductionOverrideRequest = z.infer<typeof fulfillmentProductionOverrideSchema>;
