import { jest } from "@jest/globals";
import { PgDialect } from "drizzle-orm/pg-core";

/** Scripted query results, real SQL predicates retained for assertions; no database connection. */
export function scriptedWorkflowTx(results: any[][]) {
  const selections = [...results];
  const writes: Array<{ kind: string; table: any; value: any; where?: any }> = [];
  const reads: Array<{ table: any; where?: any; locked?: boolean; fields?: any }> = [];
  const chain = (result: any, record: any) => {
    const q: any = {
      from: (table: any) => { record.table = table; return q; },
      innerJoin: () => q, leftJoin: () => q, orderBy: () => q, limit: () => q,
      where: (where: any) => { record.where = where; return q; },
      for: () => { record.locked = true; return q; },
      returning: () => q, onConflictDoNothing: () => q,
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
    };
    return q;
  };
  const tx: any = {
    select: (fields: any) => {
      if (!selections.length) throw new Error("Unscripted select");
      const read = { fields, table: null }; reads.push(read);
      return chain(selections.shift(), read);
    },
    update: (table: any) => ({ set: (value: any) => {
      const write = { kind: "update", table, value }; writes.push(write);
      return chain([{ id: "session" }], write);
    } }),
    insert: (table: any) => ({ values: (value: any) => {
      const write = { kind: "insert", table, value }; writes.push(write);
      return chain([{ id: "created", ...value }], write);
    } }),
  };
  return { tx, reads, writes, remaining: () => selections.length,
    predicate: (where: any) => new PgDialect().sqlToQuery(where),
    transaction: jest.fn(async (callback: any) => {
      const before = writes.length;
      try { return await callback(tx); } catch (error) { writes.splice(before); throw error; }
    }),
  };
}
