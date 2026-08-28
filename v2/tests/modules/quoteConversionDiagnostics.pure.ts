import assert from "node:assert/strict";
import { createQuoteConversionTrace } from "../../src/modules/sales/quoteConversionApplication.js";

const messages: string[] = [];
const trace = createQuoteConversionTrace({ requestId: "trace-request-a", sink: (message) => messages.push(message) });
trace.event("acceptance_request_received", "started");
trace.event("transaction", "committed");
trace.failure("order_insert", { code: "23505", constraint: "v2_billing_invoices_customer_tenant_fk" });
trace.durableRequest("opaque-client-request-value", "new");

assert.equal(messages.length, 4, "each trace event should produce one retained plaintext message");
assert(messages.every((message) => message.startsWith("V2_QUOTE_CONVERSION_TRACE request=trace-request-a stage=")), "trace messages must retain their request correlation and stage");
assert(messages.some((message) => message.includes("stage=transaction result=committed")), "commit must be retained");
assert(messages.some((message) => message.includes("stage=order_insert result=failed class=DATABASE_CONSTRAINT")), "safe failure classification must be retained");
assert(messages.some((message) => message.includes("constraint=v2_billing_invoices_customer_tenant_fk")), "a bounded database constraint identifier must be retained without a driver error message");
assert(messages.some((message) => message.includes("stage=durable_request result=ok durable=") && !message.includes("opaque-client-request-value")), "durable request identity must be classified without raw logging");
assert(messages.every((message) => !/(email|token|cookie|authorization|sql)/i.test(message)), "diagnostic messages must not contain forbidden sensitive fields");

const second = createQuoteConversionTrace({ requestId: "trace-request-b", sink: () => undefined });
assert.notEqual(trace.requestId, second.requestId, "separate requests require distinguishable correlations");

const failingSink = createQuoteConversionTrace({ requestId: "trace-request-c", sink: () => { throw new Error("sink unavailable"); } });
assert.doesNotThrow(() => failingSink.event("transaction", "rolled_back"), "diagnostics must never fail the transaction");

console.log("[quote-conversion-diagnostics] plaintext correlation, safe classification, and non-throwing sink checks passed.");
