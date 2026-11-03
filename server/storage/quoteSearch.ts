import { customerContacts, customers, orders, quotes } from "@shared/schema";
import { sql } from "drizzle-orm";

/** Applied inside the existing authorized Quote query, including its count. */
export function buildQuoteSearchCondition(organizationId: string, search: string) {
    // Search literal text, rather than allowing SQL LIKE wildcards from user input.
    const literal = search.trim().replace(/[\\%_]/g, "\\$&");
    const term = `%${literal}%`;
    // Legacy Quotes may store only a numeric identity, even when staff type QT-.
    const numberTerm = `%${literal.replace(/^QT[-\s]*(?=\d)/i, "")}%`;
    return sql`(
        ${quotes.quoteNumber}::text ilike ${numberTerm}
        OR ${quotes.numberCore}::text ilike ${numberTerm}
        OR ${quotes.displayNumber} ilike ${term}
        OR ${quotes.label} ilike ${term}
        OR ${quotes.customerName} ilike ${term}
        OR ${customers.companyName} ilike ${term}
        OR exists (
            select 1 from ${customerContacts}
            where ${customerContacts.id} = ${quotes.contactId}
              and ${customerContacts.organizationId} = ${organizationId}
              and (
                ${customerContacts.firstName} ilike ${term}
                OR ${customerContacts.lastName} ilike ${term}
                OR ${customerContacts.email} ilike ${term}
                OR concat_ws(' ', ${customerContacts.firstName}, ${customerContacts.lastName}) ilike ${term}
              )
        )
        OR exists (
            select 1 from ${orders}
            where ${orders.organizationId} = ${organizationId}
              and (${orders.quoteId} = ${quotes.id} OR ${orders.id} = ${quotes.convertedToOrderId})
              and ${orders.poNumber} ilike ${term}
        )
    )`;
}
