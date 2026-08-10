import { and, asc, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import { customerContacts, customers, orders, quotes } from "@shared/schema";
import {
  getEffectiveWorkflowState,
  isOpenQuoteWorkflowState,
  type QuoteWorkflowState,
} from "@shared/quoteWorkflow";
import type { z } from "zod";
import type { assistantQuoteSearchInputSchema } from "@shared/assistantContracts";

export type AssistantQuoteSearchInput = z.infer<typeof assistantQuoteSearchInputSchema>;

export type AssistantQuoteSearchRecord = {
  quoteId: string;
  quoteNumber: string;
  customer: { id?: string; name: string; sourceLink?: { label: string; href: string; entityType: "customer"; entityId: string } };
  total: number;
  status: QuoteWorkflowState;
  open: boolean;
  createdAt: Date | string;
  relatedOrderId?: string;
  sourceLink: { label: string; href: string; entityType: "quote"; entityId: string };
};

export interface AssistantQuoteSearchRepository {
  search(organizationId: string, input: AssistantQuoteSearchInput): Promise<{ totalMatchingQuotes: number; quotes: AssistantQuoteSearchRecord[] }>;
}

function escapedPattern(value: string): string {
  return `%${value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
}

function displayQuoteNumber(row: { displayNumber: string | null; numberCore: number | null; quoteNumber: number | null }): string {
  return row.displayNumber ?? (row.numberCore ?? row.quoteNumber ? String(row.numberCore ?? row.quoteNumber) : "Unnumbered");
}

/** The same canonical query conditions back both the count and the bounded
 * result page. Lifecycle semantics remain shared with the quote workflow,
 * while tenant scope never comes from tool arguments. */
export class DrizzleAssistantQuoteSearchRepository implements AssistantQuoteSearchRepository {
  constructor(private readonly dbInstance = db) {}

  async search(organizationId: string, input: AssistantQuoteSearchInput) {
    const converted = sql<boolean>`(${quotes.convertedToOrderId} is not null OR exists (
      select 1 from ${orders}
      where ${orders.quoteId} = ${quotes.id}
        and ${orders.organizationId} = ${organizationId}
    ))`;
    const open = sql<boolean>`(
      NOT ${converted}
      AND (
        ${quotes.status} = 'draft'
        OR ${quotes.status} = 'pending_approval'
        OR (${quotes.status} = 'pending' AND (${quotes.validUntil} is null OR ${quotes.validUntil} >= now()))
      )
    )`;
    const conditions = [eq(quotes.organizationId, organizationId)];

    if (input.customer) {
      const pattern = escapedPattern(input.customer);
      conditions.push(or(
        ilike(quotes.customerName, pattern),
        ilike(customers.companyName, pattern),
        ilike(customerContacts.firstName, pattern),
        ilike(customerContacts.lastName, pattern),
        ilike(customerContacts.email, pattern),
      )!);
    }
    if (input.quoteNumber) {
      const exact = input.quoteNumber.trim();
      conditions.push(sql`(
        ${quotes.displayNumber} ilike ${escapedPattern(exact)}
        OR ${quotes.quoteNumber}::text = ${exact}
        OR ${quotes.numberCore}::text = ${exact}
      )`);
    }
    if (input.createdAtRange) {
      conditions.push(gte(quotes.createdAt, new Date(input.createdAtRange.start)));
      conditions.push(lte(quotes.createdAt, new Date(input.createdAtRange.end)));
    }
    if (input.lifecycle === "open") conditions.push(open);
    if (input.lifecycle === "closed") conditions.push(sql`NOT ${open}`);
    if (input.status) {
      const statusConditions: Record<QuoteWorkflowState, typeof open> = {
        draft: sql`(${quotes.status} = 'draft' AND NOT ${converted})`,
        pending_approval: sql`(${quotes.status} = 'pending_approval' AND NOT ${converted})`,
        sent: sql`(${quotes.status} = 'pending' AND (${quotes.validUntil} is null OR ${quotes.validUntil} >= now()) AND NOT ${converted})`,
        approved: sql`(${quotes.status} = 'active' AND NOT ${converted})`,
        rejected: sql`${quotes.status} = 'canceled'`,
        expired: sql`(${quotes.status} = 'pending' AND ${quotes.validUntil} is not null AND ${quotes.validUntil} < now() AND NOT ${converted})`,
        converted,
      };
      conditions.push(statusConditions[input.status]);
    }

    const whereClause = and(...conditions);
    const orderBy = input.sort === "oldest"
      ? [asc(quotes.createdAt), asc(quotes.id)]
      : input.sort === "total_desc"
        ? [desc(sql`${quotes.totalPrice}::numeric`), asc(quotes.id)]
        : input.sort === "total_asc"
          ? [asc(sql`${quotes.totalPrice}::numeric`), asc(quotes.id)]
          : [desc(quotes.createdAt), asc(quotes.id)];
    const limit = input.limit ?? 5;

    const [{ totalMatchingQuotes }] = await this.dbInstance
      .select({ totalMatchingQuotes: sql<number>`count(*)::int` })
      .from(quotes)
      .leftJoin(customers, and(eq(customers.id, quotes.customerId), eq(customers.organizationId, organizationId)))
      .leftJoin(customerContacts, and(eq(customerContacts.id, quotes.contactId), eq(customerContacts.organizationId, organizationId)))
      .where(whereClause);

    const rows = await this.dbInstance
      .select({
        quote: quotes,
        customerCompanyName: customers.companyName,
        contactDisplayName: sql<string | null>`nullif(trim(concat_ws(' ', ${customerContacts.firstName}, ${customerContacts.lastName})), '')`,
        contactEmail: customerContacts.email,
        hasOrder: converted,
        relatedOrderId: sql<string | null>`coalesce(${quotes.convertedToOrderId}, (
          select ${orders.id} from ${orders}
          where ${orders.quoteId} = ${quotes.id}
            and ${orders.organizationId} = ${organizationId}
          order by ${orders.createdAt} desc
          limit 1
        ))`,
      })
      .from(quotes)
      .leftJoin(customers, and(eq(customers.id, quotes.customerId), eq(customers.organizationId, organizationId)))
      .leftJoin(customerContacts, and(eq(customerContacts.id, quotes.contactId), eq(customerContacts.organizationId, organizationId)))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(limit);

    return {
      totalMatchingQuotes,
      quotes: rows.map(({ quote, customerCompanyName, contactDisplayName, contactEmail, hasOrder, relatedOrderId }) => {
        const status = getEffectiveWorkflowState(quote.status, quote.validUntil ?? null, Boolean(hasOrder));
        const customerName = customerCompanyName ?? quote.customerName ?? contactDisplayName ?? contactEmail ?? "Unassigned customer";
        return {
          quoteId: quote.id,
          quoteNumber: displayQuoteNumber(quote),
          customer: {
            ...(quote.customerId ? {
              id: quote.customerId,
              sourceLink: { label: customerName, href: `/customers/${quote.customerId}`, entityType: "customer" as const, entityId: quote.customerId },
            } : {}),
            name: customerName,
          },
          total: Number(quote.totalPrice),
          status,
          open: isOpenQuoteWorkflowState(status),
          createdAt: quote.createdAt,
          ...(relatedOrderId ? { relatedOrderId } : {}),
          sourceLink: { label: `Quote ${displayQuoteNumber(quote)}`, href: `/quotes/${quote.id}`, entityType: "quote" as const, entityId: quote.id },
        };
      }),
    };
  }
}
