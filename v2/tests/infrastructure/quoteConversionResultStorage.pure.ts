import assert from "node:assert/strict";
import { PostgresQuoteTransaction } from "../../infrastructure/sales/postgresQuoteTransaction.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

const queries: Array<Readonly<{ text: string; values: readonly unknown[] }>> = [];
const client = {
  async query<T>(text: string, values: readonly unknown[] = []): Promise<{ rows: T[] }> {
    queries.push({ text, values });
    return { rows: [{} as T] };
  },
};

const transaction = new PostgresQuoteTransaction(client as never);
await transaction.succeedConversion(
  "organization-a",
  "request-a",
  brandedId<"QuoteId">("quote-a"),
  { quote: { number: { kind: "quote", core: 1016n, display: "QT-1016" } } },
);

const completion = queries.find(({ text }) => text.includes("UPDATE v2_operation_requests"));
assert(completion, "conversion completion must persist the durable operation result");
const stored = JSON.parse(completion.values[4] as string) as { quote: { number: { core: string } } };
assert.equal(stored.quote.number.core, "1016", "the result serializer must make the bigint number core JSON-safe");
console.log("[quote-conversion-storage] durable conversion replay result is JSON-safe.");
