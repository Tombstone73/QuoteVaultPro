import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { InboundOrdersRepository } from "../../storage/inboundOrders.repo";
import { fingerprintInboundEmailEvidence } from "../../services/inboundOrders/inboundEmailEvidenceFingerprint";
import { inboundQueueBucket } from "@shared/inboundAccountability";

// Exercise the real repository transaction bodies with an in-memory Drizzle
// executor. This checks decisions and SQL lock participation, not PostgreSQL's
// scheduler or actual lock behavior (which requires an isolated database).
export function inboundEvidenceHarness() {
  const record: any = { id: "email-1", organizationId: "tenant-a", sourceType: "email", sourceMessageId: "m1",
    status: "needs_review", rawPayloadJson: { subject: "Order", bodyText: "Ten signs" }, normalizedPayloadJson: {},
    createdOrderId: null, createdQuoteId: null };
  const tables: Record<string, any[]> = {
    inbound_email_processing_jobs: [], organizations: [{ id: "tenant-a", settings: {} }],
    inbound_order_records: [record], inbound_order_files: [], inbound_order_review_snapshots: [],
    inbound_order_events: [], inbound_order_parse_attempts: [], orders: [], quotes: [], inbound_order_line_items: [], inbound_email_ignore_rules: [],
  };
  const calls: string[] = [];
  const dialect = new PgDialect();
  let now = Date.now();
  function rows(table: any, condition?: any) {
    const name = getTableName(table);
    if (!condition) return tables[name] ?? [];
    const query = dialect.sqlToQuery(condition);
    calls.push(query.sql);
    if (name === "inbound_email_processing_jobs") {
      // Evaluate the controlled Drizzle predicates, including the claim's OR
      // and lease clock. This is a serialized model, not PostgreSQL lock proof.
      const expression = query.sql
        .replace(/"[a-z_]+"\."([a-z_]+)"/g, (_, column) => `row.${column.replace(/_([a-z])/g, (_: string, letter: string) => letter.toUpperCase())}`)
        .replace(/\$(\d+)/g, (_, index) => `params[${Number(index) - 1}]`)
        .replace(/row\.(\w+) in \(([^)]+)\)/g, "[$2].includes(row.$1)")
        .replace(/now\(\)/g, "now").replace(/\band\b/g, "&&").replace(/\bor\b/g, "||")
        .replace(/<>/g, "!==").replace(/(?<![<>!]) = /g, " === ");
      return (tables[name] ?? []).filter(row => Function("row", "params", "now", `return (${expression})`)(row, query.params, new Date(now)));
    }
    const camel = (value: string) => value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    return (tables[name] ?? []).filter((row) => {
      if (name === "inbound_order_records" && query.sql.includes("case")) {
        // A model of the projection filters, not execution of SQL CASE by PG.
        const bucket = inboundQueueBucket(row);
        if (query.sql.includes("end in ('needs_review', 'waiting', 'ready')") && !["needs_review", "waiting", "ready"].includes(bucket)) return false;
        if (query.sql.includes("end = 'converted'") && bucket !== "converted") return false;
        if (query.sql.includes("end <> 'converted'") && bucket === "converted") return false;
        for (const match of query.sql.matchAll(/end = \$(\d+)/g)) if (bucket !== query.params[Number(match[1]) - 1]) return false;
      }
      for (const match of query.sql.matchAll(/"([a-z_]+)" = \$(\d+)/g)) {
        if (row[camel(match[1])] !== query.params[Number(match[2]) - 1]) return false;
      }
      for (const match of query.sql.matchAll(/"([a-z_]+)" in \(([^)]+)\)/g)) {
        const values = [...match[2].matchAll(/\$(\d+)/g)].map((value) => query.params[Number(value[1]) - 1]);
        if (!values.includes(row[camel(match[1])])) return false;
      }
      if (query.sql.includes("->>'combinedParentRecordId' =")) return row.normalizedPayloadJson?.combinedParentRecordId === query.params[1];
      if (query.sql.includes('"created_order_id" is null') && row.createdOrderId) return false;
      if (query.sql.includes('"created_quote_id" is null') && row.createdQuoteId) return false;
      if (query.sql.includes("->>'attachedOrderId', '') is null") && row.normalizedPayloadJson?.attachedOrderId) return false;
      if (query.sql.includes("->>'combinedParentRecordId', '') is null") && row.normalizedPayloadJson?.combinedParentRecordId) return false;
      return true;
    });
  }
  let sequence = 0;
  function query(table: any, mode: string, fields?: Record<string, any>) {
    let condition: any;
    let values: any;
    let limit: number | undefined;
    let dedupe = false;
    const execute = () => {
      const name = getTableName(table);
      if (mode === "insert") {
        if (dedupe && name === "inbound_email_processing_jobs" && tables[name].some(row => row.organizationId === values.organizationId && row.inboundRecordId === values.inboundRecordId && row.evidenceFingerprint === values.evidenceFingerprint)) return [];
        const inserted = { id: `row-${++sequence}`, createdAt: new Date(now), updatedAt: new Date(now), attempts: 0, claimToken: null, claimExpiresAt: null, nextAttemptAt: new Date(now), ...values };
        tables[name].unshift(inserted);
        calls.push(`insert:${name}`);
        return [structuredClone(inserted)];
      }
      const selected = rows(table, condition);
      if (mode === "select" && fields?.needsReview) {
        const buckets = selected.map(inboundQueueBucket);
        for (const field of Object.values(fields)) if (field?.queryChunks) calls.push(dialect.sqlToQuery(field).sql);
        return [{ needsReview: buckets.filter(b => b === "needs_review").length, waitingOnCustomer: buckets.filter(b => b === "waiting").length,
          readyReviewed: buckets.filter(b => b === "ready").length, convertedSubmitted: buckets.filter(b => b === "converted").length,
          rejectedTerminal: buckets.filter(b => b === "rejected").length, ignored: buckets.filter(b => b === "ignored").length, withWarnings: 0 }];
      }
      if (mode === "update") {
        const resolved = Object.fromEntries(Object.entries(values).map(([key, value]: any) => [key,
          value?.queryChunks ? new Date(now + Number(dialect.sqlToQuery(value).params[0] ?? 0)) : value]));
        selected.forEach((row) => Object.assign(row, resolved));
        calls.push(`update:${name}`);
      }
      return structuredClone(selected.slice(0, limit));
    };
    const chain: any = {
      where: (value: any) => { condition = value; return chain; },
      limit: (value: number) => { limit = value; return chain; },
      orderBy: () => chain,
      offset: () => chain,
      // Joins are used only by empty optional-rule/catalog tables in these
      // fixtures. This harness does not model relational joins with data.
      leftJoin: () => chain,
      innerJoin: () => chain,
      for: (value: string, options?: { skipLocked?: boolean }) => { calls.push(`for:${value}${options?.skipLocked ? ":skipLocked" : ""}`); return chain; },
      set: (value: any) => { values = value; return chain; },
      values: (value: any) => { values = value; return chain; },
      returning: () => chain,
      onConflictDoNothing: () => { dedupe = true; return chain; },
      onConflictDoUpdate: () => chain,
      then: (resolve: any, reject: any) => Promise.resolve().then(execute).then(resolve, reject),
    };
    return chain;
  }
  let transactionTail = Promise.resolve();
  let activeTransactions = 0;
  const executor: any = {
    execute: async (statement: any) => { calls.push(dialect.sqlToQuery(statement).sql); return []; },
    select: (fields?: Record<string, any>) => ({ from: (table: any) => query(table, "select", fields) }),
    update: (table: any) => query(table, "update"), insert: (table: any) => query(table, "insert"),
    transaction: async (callback: any) => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise(resolve => { release = resolve; });
      await previous;
      activeTransactions++;
      const before = structuredClone(tables);
      calls.push("transaction");
      const nested: any = { ...executor, transaction: async (callback: any) => callback(nested) };
      try { return await callback(nested); }
      catch (error) { for (const key of Object.keys(tables)) tables[key] = before[key]; throw error; }
      finally { activeTransactions--; release(); }
    },
  };
  const repo = new InboundOrdersRepository(executor);
  const current = () => tables.inbound_order_records[0];
  const fingerprint = () => fingerprintInboundEmailEvidence(current(), tables.inbound_order_files);
  const addDraft = (covered: string | null = fingerprint()) => {
    const snapshot = { id: `draft-${++sequence}`, organizationId: "tenant-a", inboundRecordId: "email-1", snapshotVersion: sequence,
      payloadJson: { status: "draft", reviewNotes: "Keep my staff edits", reviewedLineItemsJson: [{ quantity: 7 }],
        metadata: { snapshotKind: "editable_review_draft", evidenceFingerprint: covered } } };
    tables.inbound_order_review_snapshots.unshift(snapshot);
    return snapshot;
  };
  return { repo, tables, calls, current, fingerprint, addDraft, executor, activeTransactions: () => activeTransactions, advance: (ms: number) => { now += ms; } };
}
