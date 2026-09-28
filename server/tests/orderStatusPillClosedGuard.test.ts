import { beforeAll, describe, expect, jest, test } from '@jest/globals';
import { PgDialect } from 'drizzle-orm/pg-core';

const db: any = {};
jest.unstable_mockModule('../db', () => ({ db }));
let assign: typeof import('../services/orderStatusPillService').assignOrderStatusPill;
beforeAll(async () => { assign = (await import('../services/orderStatusPillService')).assignOrderStatusPill; });

describe('persisted closed Order status-pill guard', () => {
  test.each(['system', 'user'] as const)('%s cannot replace Closed, including closure between read and write', async source => {
    const previous = { id: 'closed-pill', key: 'closed', name: 'Closed' };
    const target = { id: 'invoiced-pill', key: 'invoiced', name: 'Invoiced' };
    const rows = [[{ id: 'order', state: 'production_complete', statusPillId: previous.id, statusPillValue: previous.name }], [previous], [target]];
    db.select = () => ({ from: () => ({ where: () => ({ limit: async () => rows.shift() }) }) });
    const lock = jest.fn(); const lockWhere = jest.fn();
    const tx: any = { update: jest.fn(), insert: jest.fn(), select: () => ({ from: () => ({ where: (predicate: any) => {
      lockWhere(predicate); return { for: (mode: string) => { lock(mode); return { limit: async () => [{ state: 'closed' }] }; } };
    } }) }) };
    db.transaction = async (fn: any) => fn(tx); db.insert = jest.fn();
    const result = await assign({ organizationId: 'tenant', orderId: 'order', statusPillKey: 'invoiced', actorUserId: 'staff', source });
    expect(result).toEqual({ eventId: null, statusPill: previous });
    expect(lock).toHaveBeenCalledWith('update');
    expect(new PgDialect().sqlToQuery(lockWhere.mock.calls[0][0] as any).params).toEqual(['order', 'tenant']);
    expect(tx.update).not.toHaveBeenCalled(); expect(tx.insert).not.toHaveBeenCalled(); expect(db.insert).not.toHaveBeenCalled();
  });
});
