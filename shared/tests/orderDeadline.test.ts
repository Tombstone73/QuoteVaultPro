import { describe, expect, test } from '@jest/globals';
import { dateOnlyDeadline, deadlineIntentEqual, formatOrderDeadline, normalizeOrderDeadline, orderDeadlineSchema, resolveLocalDeadlineInstant } from '../orderDeadline';
import { buildOrderTravelerData, buildTicketData } from '../productionTicket';
describe('canonical Order deadline semantics', () => {
    test('historical dates stay calendar dates without invented times', () => {
        expect(formatOrderDeadline(null, '2026-11-10T12:00:00Z')).toBe('Nov 10, 2026');
        expect(normalizeOrderDeadline(dateOnlyDeadline('2026-11-10'), 'America/Indiana/Indianapolis')).toMatchObject({ kind: 'date_only', localTime: null, instant: null });
    });
    test('EOD is explicit, keeps evidence, and never gains an arbitrary instant', () => {
        const value = normalizeOrderDeadline({ ...dateOnlyDeadline('2026-11-10', 'November 10 EOD'), kind: 'eod' }, 'America/Indiana/Indianapolis');
        expect(value).toMatchObject({ kind: 'eod', instant: null, localTime: null, sourceText: 'November 10 EOD' });
        expect(formatOrderDeadline(value)).toContain('EOD (America/Indiana/Indianapolis)');
        expect(orderDeadlineSchema.safeParse({ ...value, instant: '2026-11-11T04:59:59Z' }).success).toBe(false);
    });
    test.each([
        ['2026-11-10', '23:30', 'America/Indiana/Indianapolis', '2026-11-11T04:30:00.000Z'],
        ['2026-07-10', '00:15', 'Asia/Kolkata', '2026-07-09T18:45:00.000Z'],
        ['2026-07-10', '12:00', 'America/New_York', '2026-07-10T16:00:00.000Z'],
    ])('resolves %s %s in %s across UTC calendar boundaries', (date, time, zone, instant) => {
        expect(resolveLocalDeadlineInstant(date, time, zone)).toBe(instant);
    });
    test('organization timezone overrides client stamps; unchanged saved intent retains its original zone', () => {
        const input = { ...dateOnlyDeadline('2026-11-10'), kind: 'time' as const, localTime: '16:00', timezone: 'UTC', instant: 'forged' };
        const saved = normalizeOrderDeadline(input, 'America/New_York')!;
        expect(saved.instant).toBe('2026-11-10T21:00:00.000Z');
        expect(normalizeOrderDeadline(input, 'Asia/Tokyo', saved)).toEqual(saved);
        expect(deadlineIntentEqual({ requested: null, accepted: input }, { requested: null, accepted: saved })).toBe(true);
    });
    test('invalid dates, missing times, DST gaps and ambiguous folds fail explicitly', () => {
        expect(orderDeadlineSchema.safeParse(dateOnlyDeadline('2026-02-30')).success).toBe(false);
        expect(orderDeadlineSchema.safeParse({ ...dateOnlyDeadline('2026-11-10'), kind: 'time' }).success).toBe(false);
        expect(() => resolveLocalDeadlineInstant('2026-03-08', '02:30', 'America/New_York')).toThrow('does not exist');
        expect(() => resolveLocalDeadlineInstant('2026-11-01', '01:30', 'America/New_York')).toThrow('occurs twice');
    });
    test('Production tickets and Fulfillment travelers display the accepted semantic deadline', () => {
        const deadlineJson = { requested: null, accepted: normalizeOrderDeadline({ ...dateOnlyDeadline('2026-11-10'), kind: 'eod' }, 'America/New_York') };
        const base = { orderId: 'order', orderNumber: '123', customerName: 'Synthetic buyer', dueDate: '2026-11-10T12:00:00Z', deadlineJson };
        const ticket = buildTicketData({ ...base, jobId: 'job', description: 'Sign', quantity: 28 });
        expect(ticket.rows.find(row => row.key === 'dueDate')?.value).toContain('EOD (America/New_York)');
        const traveler = buildOrderTravelerData({ ...base, lineItems: [] });
        expect(traveler.headerRows.find(row => row.key === 'dueDate')?.value).toContain('EOD (America/New_York)');
    });
});
