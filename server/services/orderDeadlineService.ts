import { eq } from 'drizzle-orm';
import { db } from '../db';
import { organizations } from '@shared/schema';
import { validOrganizationTimezone } from '../lib/orderDueDate';
import { dateOnlyDeadline, deadlineCalendarDate, deadlineCalendarTimestamp, normalizeOrderDeadline, orderDeadlineStateSchema, type OrderDeadlineState } from '@shared/orderDeadline';
type Fields = {
    deadlineJson?: OrderDeadlineState | null;
    dueDate?: string | Date | null;
    requestedDueDate?: string | Date | null;
};
export class OrderDeadlineValidationError extends Error {
    readonly code = "ORDER_DEADLINE_INVALID";
    readonly statusCode = 400;
}
export async function normalizeDeadlineFields(organizationId: string, input: Fields, previous?: Fields | null, executor: Pick<typeof db, 'select'> = db, quote = false): Promise<Fields> {
    let state = input.deadlineJson;
    if (state === undefined && previous?.deadlineJson) {
        state = { ...previous.deadlineJson };
        let changed = false;
        for (const [field, key] of [['dueDate', 'accepted'], ['requestedDueDate', 'requested']] as const) {
            if (input[field] === undefined || deadlineCalendarDate(input[field]) === deadlineCalendarDate(previous[field]))
                continue;
            const date = deadlineCalendarDate(input[field]);
            state[key] = date ? dateOnlyDeadline(date) : null;
            changed = true;
        }
        if (!changed)
            return {};
    }
    if (state === undefined)
        return {};
    if (state === null)
        return { deadlineJson: null };
    const parsed = orderDeadlineStateSchema.parse(state);
    if (quote && parsed.accepted)
        throw new OrderDeadlineValidationError('A Quote records a requested deadline. Accept it explicitly when creating the Order.');
    const [org] = await executor.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    if (!org)
        throw new Error('Organization not found for deadline validation.');
    const settings = org.settings as {
        timezone?: string;
        preferences?: {
            timezone?: string;
        };
    } | null;
    const timezone = validOrganizationTimezone(settings?.timezone ?? settings?.preferences?.timezone);
    let normalized: OrderDeadlineState;
    try {
        normalized = { requested: normalizeOrderDeadline(parsed.requested, timezone, previous?.deadlineJson?.requested), accepted: normalizeOrderDeadline(parsed.accepted, timezone, previous?.deadlineJson?.accepted) };
    }
    catch (error) {
        throw new OrderDeadlineValidationError(error instanceof Error ? error.message : 'Invalid Order deadline.');
    }
    return { deadlineJson: normalized, requestedDueDate: deadlineCalendarTimestamp(normalized.requested), ...(!quote ? { dueDate: deadlineCalendarTimestamp(normalized.accepted) } : {}) };
}
