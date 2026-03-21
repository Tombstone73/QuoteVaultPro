import {
  insertOrderInternalNoteSchema,
  insertOrderLineItemNoteSchema,
  orderLineItemNoteCategorySchema,
  type OrderLineItemNoteCategory,
} from "@shared/schema";

import { structuredOrderNotesRepository } from "../storage/structuredOrderNotes.repo";

const normalizeNoteText = (value: string): string => value.trim();

const normalizeAudienceTags = (value: string[] | null | undefined): string[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized = value
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return normalized.length > 0 ? normalized : null;
};

export async function listOrderInternalNotes(args: {
  organizationId: string;
  orderId: string;
  executor?: any;
}) {
  const ownership = await structuredOrderNotesRepository.getOrderOwnership(
    args.organizationId,
    args.orderId,
    args.executor,
  );

  if (!ownership) {
    return null;
  }

  return structuredOrderNotesRepository.listOrderInternalNotes(
    args.organizationId,
    args.orderId,
    args.executor,
  );
}

export async function addOrderInternalNote(args: {
  organizationId: string;
  orderId: string;
  userId: string | null;
  values: unknown;
  executor?: any;
}) {
  const parsed = insertOrderInternalNoteSchema.parse(args.values);
  const ownership = await structuredOrderNotesRepository.getOrderOwnership(
    args.organizationId,
    args.orderId,
    args.executor,
  );

  if (!ownership) {
    return null;
  }

  const created = await structuredOrderNotesRepository.addOrderInternalNote(
    args.organizationId,
    args.orderId,
    args.userId,
    {
      noteText: normalizeNoteText(parsed.noteText),
      audienceTags: normalizeAudienceTags(parsed.audienceTags),
    },
    args.executor,
  );

  return created;
}

export async function listLineItemNotes(args: {
  organizationId: string;
  orderId: string;
  lineItemId: string;
  category?: string | null;
  executor?: any;
}) {
  const ownership = await structuredOrderNotesRepository.getLineItemOwnership(
    args.organizationId,
    args.orderId,
    args.lineItemId,
    args.executor,
  );

  if (!ownership) {
    return null;
  }

  const category = args.category == null || args.category === ""
    ? null
    : (orderLineItemNoteCategorySchema.parse(args.category) as OrderLineItemNoteCategory);

  return structuredOrderNotesRepository.listLineItemNotes(
    args.organizationId,
    args.orderId,
    args.lineItemId,
    category,
    args.executor,
  );
}

export async function addLineItemNote(args: {
  organizationId: string;
  orderId: string;
  lineItemId: string;
  userId: string | null;
  values: unknown;
  executor?: any;
}) {
  const parsed = insertOrderLineItemNoteSchema.parse(args.values);
  const ownership = await structuredOrderNotesRepository.getLineItemOwnership(
    args.organizationId,
    args.orderId,
    args.lineItemId,
    args.executor,
  );

  if (!ownership) {
    return null;
  }

  const created = await structuredOrderNotesRepository.addLineItemNote(
    args.organizationId,
    args.orderId,
    args.lineItemId,
    args.userId,
    {
      category: parsed.category,
      noteText: normalizeNoteText(parsed.noteText),
    },
    args.executor,
  );

  return created;
}