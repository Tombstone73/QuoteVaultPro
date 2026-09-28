import { z } from "zod";
import { resolveOrganizationRoleAuthority } from "./organizationRoleAuthority";

export const PICKUP_HISTORY_NOTE_UPDATED = "PICKUP_HISTORY_NOTE_UPDATED";
export const FULFILLMENT_HISTORY_NOTE_MAX_LENGTH = 2000;
export const fulfillmentHistoryNoteSchema = z.object({
  note: z.string().trim().max(FULFILLMENT_HISTORY_NOTE_MAX_LENGTH),
}).strict();

export function canEditFulfillmentHistoryNotes(role: unknown): boolean {
  return resolveOrganizationRoleAuthority(role).grants.includes("assistant.fulfillment.add_note");
}

export type FulfillmentHistoryNote = {
  text: string;
  updatedAt: string;
  actorUserId: string | null;
  actorName: string | null;
};

/** Events come from the tenant-scoped ledger, ordered newest first by the database. */
export function currentPickupHistoryNote(orderId: string, handoffId: string, events: Array<{
  eventType: string;
  payloadJson: Record<string, any>;
  createdAt: Date | string;
  actorUserId: string | null;
  actorFirstName?: string | null;
  actorLastName?: string | null;
}>): FulfillmentHistoryNote | null {
  for (const event of events) {
    if (event.eventType !== PICKUP_HISTORY_NOTE_UPDATED || event.payloadJson.orderId !== orderId || event.payloadJson.pickupHandoffId !== handoffId) continue;
    const parsed = fulfillmentHistoryNoteSchema.safeParse({ note: event.payloadJson.note });
    if (!parsed.success) continue;
    // An empty update clears the current note; older evidence stays in the ledger.
    if (!parsed.data.note) return null;
    return {
      text: parsed.data.note,
      updatedAt: new Date(event.createdAt).toISOString(),
      actorUserId: event.actorUserId,
      actorName: [event.actorFirstName, event.actorLastName].filter(Boolean).join(" ") || null,
    };
  }
  return null;
}
