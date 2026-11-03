import { z } from 'zod';
export const deadlineDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Enter a valid deadline date.');
export const orderDeadlineSchema = z.object({
    date: deadlineDateSchema,
    kind: z.enum(['date_only', 'eod', 'time']),
    localTime: z.string().nullable().default(null),
    timezone: z.string().nullable().default(null),
    instant: z.string().nullable().default(null),
    sourceText: z.string().max(1000).nullable().default(null),
}).superRefine((value, ctx) => {
    if (value.kind === 'time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.localTime ?? ''))
        ctx.addIssue({ code: 'custom', path: ['localTime'], message: 'Enter a local time in HH:mm format.' });
    if (value.kind !== 'time' && (value.localTime || value.instant))
        ctx.addIssue({ code: 'custom', message: 'Date-only and EOD deadlines must not contain a time or instant.' });
});
export const orderDeadlineStateSchema = z.object({
    requested: orderDeadlineSchema.nullable().default(null),
    accepted: orderDeadlineSchema.nullable().default(null),
}).strict();
export type OrderDeadline = z.infer<typeof orderDeadlineSchema>;
export type OrderDeadlineState = z.infer<typeof orderDeadlineStateSchema>;
export function deadlineIntentEqual(a: OrderDeadlineState | null | undefined, b: OrderDeadlineState | null | undefined): boolean {
    const intent = (state: OrderDeadlineState | null | undefined) => state ? ['requested', 'accepted'].map(key => {
        const value = state[key as keyof OrderDeadlineState];
        return value ? [value.date, value.kind, value.localTime, value.sourceText] : null;
    }) : null;
    return JSON.stringify(intent(a)) === JSON.stringify(intent(b));
}
export function dateOnlyDeadline(date: string, sourceText: string | null = null): OrderDeadline {
    return { date, kind: 'date_only', localTime: null, timezone: null, instant: null, sourceText };
}
export function deadlineCalendarDate(value: string | Date | null | undefined): string | null {
    if (!value)
        return null;
    const text = value instanceof Date ? value.toISOString() : value;
    const part = text.slice(0, 10);
    return deadlineDateSchema.safeParse(part).success ? part : null;
}
export function deadlineCalendarTimestamp(value: OrderDeadline | null): string | null {
    return value ? `${value.date}T00:00:00.000Z` : null;
}
/** A presentation of semantics, never a scheduling/priority calculation. */
export function formatOrderDeadline(deadline: OrderDeadline | null | undefined, legacyDate?: string | Date | null): string {
    const date = deadline?.date ?? deadlineCalendarDate(legacyDate);
    if (!date)
        return '—';
    const label = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
    if (!deadline || deadline.kind === 'date_only')
        return label;
    return `${label} · ${deadline.kind === 'eod' ? 'EOD' : deadline.localTime}${deadline.timezone ? ` (${deadline.timezone})` : ''}`;
}
function localParts(instant: number, timezone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
    const part = (key: string) => parts.find(value => value.type === key)!.value;
    return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
/** Reject DST gaps/folds rather than inventing an offset for an ambiguous time. */
export function resolveLocalDeadlineInstant(date: string, localTime: string, timezone: string): string {
    const target = Date.parse(`${date}T${localTime}:00Z`), candidates = new Set<number>();
    for (let hours = -36; hours <= 36; hours += 6) {
        const sample = target + hours * 3600000;
        const local = Date.parse(`${localParts(sample, timezone)}:00Z`);
        const candidate = target - (local - sample);
        if (localParts(candidate, timezone) === `${date}T${localTime}`)
            candidates.add(candidate);
    }
    if (candidates.size !== 1)
        throw new Error(candidates.size ? 'This local time occurs twice at the daylight-saving transition. Choose an unambiguous deadline time.' : 'This local time does not exist at the daylight-saving transition. Choose a valid deadline time.');
    return new Date([...candidates][0]).toISOString();
}
/** Server-owned timezone and instant; supplied offsets/instants have no authority. */
export function normalizeOrderDeadline(value: OrderDeadline | null, timezone: string, previous?: OrderDeadline | null): OrderDeadline | null {
    if (!value)
        return null;
    const parsed = orderDeadlineSchema.parse(value);
    if (previous && ['date', 'kind', 'localTime', 'sourceText'].every(key => parsed[key as keyof OrderDeadline] === previous[key as keyof OrderDeadline]))
        return previous;
    return { ...parsed, timezone, instant: parsed.kind === 'time' ? resolveLocalDeadlineInstant(parsed.date, parsed.localTime!, timezone) : null };
}
