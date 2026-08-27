import { and, eq, ne, or, sql } from 'drizzle-orm';
import { invoices, orders, quotes } from '@shared/schema';
import {
  findHistoricalQuickBooksNumberConflicts,
  type HistoricalQuickBooksInvoiceNumber,
  type HistoricalQuickBooksNumberConflict,
  type HistoricalQuickBooksNumberRecord,
} from '@shared/quickBooksHistoricalNumbering';
import { db } from '../db';

type DbExecutor = typeof db | any;

export async function findHistoricalQuickBooksInvoiceNumberConflicts(input: {
  organizationId: string;
  identity: HistoricalQuickBooksInvoiceNumber;
  excludeInvoiceId?: string;
  executor?: DbExecutor;
}): Promise<HistoricalQuickBooksNumberConflict[]> {
  const executor = input.executor ?? db;
  const numeric = input.identity.numberCore;
  const invoiceConditions = [
    sql`lower(btrim(${invoices.displayNumber})) = lower(${input.identity.displayNumber})`,
    sql`lower(btrim(${invoices.qbDocNumber})) = lower(${input.identity.sourceDocNumber})`,
  ];
  const orderConditions = [sql`lower(btrim(${orders.displayNumber})) = lower(${input.identity.displayNumber})`];
  const quoteConditions = [sql`lower(btrim(${quotes.displayNumber})) = lower(${input.identity.displayNumber})`];

  if (numeric != null) {
    invoiceConditions.push(eq(invoices.numberCore, numeric), eq(invoices.jobNumber, numeric), eq(invoices.invoiceNumber, numeric));
    orderConditions.push(eq(orders.numberCore, numeric), eq(orders.jobNumber, numeric));
    quoteConditions.push(eq(quotes.numberCore, numeric), eq(quotes.jobNumber, numeric));
  }

  const invoiceWhere = [eq(invoices.organizationId, input.organizationId), or(...invoiceConditions)];
  if (input.excludeInvoiceId) invoiceWhere.push(ne(invoices.id, input.excludeInvoiceId));

  const [invoiceRows, orderRows, quoteRows] = await Promise.all([
    executor.select({
      id: invoices.id,
      qbDocNumber: invoices.qbDocNumber,
      displayNumber: invoices.displayNumber,
      numberCore: invoices.numberCore,
      jobNumber: invoices.jobNumber,
      invoiceNumber: invoices.invoiceNumber,
    }).from(invoices).where(and(...invoiceWhere)),
    executor.select({
      id: orders.id,
      displayNumber: orders.displayNumber,
      numberCore: orders.numberCore,
      jobNumber: orders.jobNumber,
    }).from(orders).where(and(eq(orders.organizationId, input.organizationId), or(...orderConditions))),
    executor.select({
      id: quotes.id,
      displayNumber: quotes.displayNumber,
      numberCore: quotes.numberCore,
      jobNumber: quotes.jobNumber,
    }).from(quotes).where(and(eq(quotes.organizationId, input.organizationId), or(...quoteConditions))),
  ]);

  const records: HistoricalQuickBooksNumberRecord[] = [
    ...invoiceRows.map((row: any) => ({ entity: 'invoice' as const, ...row })),
    ...orderRows.map((row: any) => ({ entity: 'order' as const, ...row })),
    ...quoteRows.map((row: any) => ({ entity: 'quote' as const, ...row })),
  ];
  return findHistoricalQuickBooksNumberConflicts(input.identity, records);
}
