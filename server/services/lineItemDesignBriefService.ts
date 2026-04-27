import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { orders, orderLineItems, type LineItemDesignBriefStatus, type UpdateLineItemDesignBrief } from "@shared/schema";
import { lineItemDesignBriefRepository } from "../storage/lineItemDesignBrief.repo";

type LineItemDesignBriefContext = {
  orderId: string;
  orderLineItemId: string;
  requiresDesignSnapshot: boolean;
  designBriefRequiredSnapshot: boolean;
  needsDesignOverride: boolean | null;
};

export type LineItemDesignBriefDetail = {
  id: string | null;
  orderId: string;
  orderLineItemId: string;
  effectiveRequiresDesign: boolean;
  designBriefRequired: boolean;
  status: LineItemDesignBriefStatus;
  keyInstructions: string | null;
  designObjective: string | null;
  requestedContent: string | null;
  layoutNotes: string | null;
  brandStyleNotes: string | null;
  referenceNotes: string | null;
  priorityNotes: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

const normalizeOptionalText = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const hasText = (value: string | null | undefined): boolean => Boolean(normalizeOptionalText(value));

export function deriveLineItemDesignBriefStatus(args: {
  effectiveRequiresDesign: boolean;
  designBriefRequired: boolean;
  keyInstructions: string | null;
  designObjective: string | null;
}): LineItemDesignBriefStatus {
  if (!args.effectiveRequiresDesign || !args.designBriefRequired) {
    return "not_required";
  }

  if (!hasText(args.keyInstructions) || !hasText(args.designObjective)) {
    return "required_missing";
  }

  return "captured";
}

async function getLineItemDesignBriefContext(
  organizationId: string,
  orderId: string,
  orderLineItemId: string,
  executor: any = db,
): Promise<LineItemDesignBriefContext | null> {
  const [row] = await executor
    .select({
      orderId: orderLineItems.orderId,
      orderLineItemId: orderLineItems.id,
      requiresDesignSnapshot: orderLineItems.requiresDesignSnapshot,
      designBriefRequiredSnapshot: orderLineItems.designBriefRequiredSnapshot,
      needsDesignOverride: orderLineItems.needsDesignOverride,
    })
    .from(orderLineItems)
    .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
    .where(
      and(
        eq(orders.organizationId, organizationId),
        eq(orderLineItems.orderId, orderId),
        eq(orderLineItems.id, orderLineItemId),
      ),
    )
    .limit(1);

  return row ?? null;
}

function toDetail(args: {
  context: LineItemDesignBriefContext;
  brief: Awaited<ReturnType<typeof lineItemDesignBriefRepository.getByLineItemId>>;
}): LineItemDesignBriefDetail {
  const { context, brief } = args;
  const effectiveRequiresDesign = context.needsDesignOverride ?? context.requiresDesignSnapshot;
  const designBriefRequired = effectiveRequiresDesign && context.designBriefRequiredSnapshot;
  const keyInstructions = normalizeOptionalText(brief?.keyInstructions);
  const designObjective = normalizeOptionalText(brief?.designObjective);
  const requestedContent = normalizeOptionalText(brief?.requestedContent);
  const layoutNotes = normalizeOptionalText(brief?.layoutNotes);
  const brandStyleNotes = normalizeOptionalText(brief?.brandStyleNotes);
  const referenceNotes = normalizeOptionalText(brief?.referenceNotes);
  const priorityNotes = normalizeOptionalText(brief?.priorityNotes);

  return {
    id: brief?.id ?? null,
    orderId: context.orderId,
    orderLineItemId: context.orderLineItemId,
    effectiveRequiresDesign,
    designBriefRequired,
    status: deriveLineItemDesignBriefStatus({
      effectiveRequiresDesign,
      designBriefRequired,
      keyInstructions,
      designObjective,
    }),
    keyInstructions,
    designObjective,
    requestedContent,
    layoutNotes,
    brandStyleNotes,
    referenceNotes,
    priorityNotes,
    createdAt: brief?.createdAt ?? null,
    updatedAt: brief?.updatedAt ?? null,
  };
}

export async function getLineItemDesignBriefDetail(args: {
  organizationId: string;
  orderId: string;
  orderLineItemId: string;
  executor?: any;
}): Promise<LineItemDesignBriefDetail | null> {
  const executor = args.executor ?? db;
  const context = await getLineItemDesignBriefContext(args.organizationId, args.orderId, args.orderLineItemId, executor);

  if (!context) {
    return null;
  }

  const brief = await lineItemDesignBriefRepository.getByLineItemId(
    args.organizationId,
    args.orderId,
    args.orderLineItemId,
    executor,
  );

  return toDetail({ context, brief });
}

export async function upsertLineItemDesignBrief(args: {
  organizationId: string;
  orderId: string;
  orderLineItemId: string;
  userId: string | null;
  values: UpdateLineItemDesignBrief;
  executor?: any;
}): Promise<LineItemDesignBriefDetail | null> {
  const executor = args.executor ?? db;
  const context = await getLineItemDesignBriefContext(args.organizationId, args.orderId, args.orderLineItemId, executor);

  if (!context) {
    return null;
  }

  const brief = await lineItemDesignBriefRepository.upsertForLineItem(
    args.organizationId,
    args.orderId,
    args.orderLineItemId,
    args.userId,
    {
      keyInstructions: normalizeOptionalText(args.values.keyInstructions),
      designObjective: normalizeOptionalText(args.values.designObjective),
      requestedContent: normalizeOptionalText(args.values.requestedContent),
      layoutNotes: normalizeOptionalText(args.values.layoutNotes),
      brandStyleNotes: normalizeOptionalText(args.values.brandStyleNotes),
      referenceNotes: normalizeOptionalText(args.values.referenceNotes),
      priorityNotes: normalizeOptionalText(args.values.priorityNotes),
    },
    executor,
  );

  return toDetail({ context, brief });
}