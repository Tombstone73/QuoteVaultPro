import { describe, expect, test } from "@jest/globals";
import {
  derivePendingOperatorActionContext,
  isAffirmativeAssistantReply,
  mergeOperatorConversationResourceContext,
  pendingActionForCurrentResources,
  pendingActionWithClarification,
  resourcesFromOperatorObservations,
  uniqueResource,
} from "../services/assistant/operatorConversationContext";

const at = "2026-09-30T12:00:00.000Z";
const order = { type: "order" as const, id: "order_fixture", label: "Order 9001" };
const customer = { type: "customer" as const, id: "customer_fixture", label: "Acme Print" };
const line = { type: "order_line" as const, id: "line_coroplast", label: "Coroplast" };
const job = { type: "production_job" as const, id: "job_peterman", label: "Peterman signs" };
const fulfillment = { type: "fulfillment" as const, id: "order_fixture", label: "Fulfillment for 9001" };

const investigation = (data: unknown) => [{ toolName: "investigation.get", status: "succeeded", result: { data, provenance: { sourceLinks: [] } } }];

describe("Operator conversation resource context", () => {
  test("retains canonical customer, order, line, job, and fulfillment references from Investigation", () => {
    const resources = resourcesFromOperatorObservations(investigation({ snapshot: { resource: order, customer, line, job, fulfillment } }));
    expect(resources).toEqual(expect.arrayContaining([order, customer, line, job, fulfillment]));
  });

  test("reuses the one current Order, line, and fulfillment for another pickup's explicit quantity and today", () => {
    const context = mergeOperatorConversationResourceContext(null, investigation({ snapshot: { resource: order, customer, line, fulfillment } }), at)!;
    const action = derivePendingOperatorActionContext({ message: "I need to add another pickup of 500 pieces today", resources: context, prior: null });
    expect(action).toMatchObject({ action: "fulfillment_pickup", order, orderLine: line, fulfillment, quantity: 500, timing: "today", confirmation: "none" });
    expect(uniqueResource(context, "order")).toEqual(order);
  });

  test("resolves same-order and this-job follow-ups against bounded canonical context", () => {
    const context = mergeOperatorConversationResourceContext(null, investigation({ snapshot: { resource: order, job } }), at)!;
    expect(uniqueResource(context, "order")).toEqual(order);
    expect(uniqueResource(context, "production_job")).toEqual(job);
    expect(derivePendingOperatorActionContext({ message: "the same order", resources: context, prior: null })).toBeNull();
  });

  test("a binary confirmation preserves known action fields and makes yes unambiguous", () => {
    const context = mergeOperatorConversationResourceContext(null, investigation({ snapshot: { resource: order, line, fulfillment } }), at)!;
    const prepared = derivePendingOperatorActionContext({ message: "add another pickup of 500 today", resources: context, prior: null });
    const awaiting = pendingActionWithClarification(prepared, "binary_confirmation")!;
    const confirmed = derivePendingOperatorActionContext({ message: "yes", resources: context, prior: awaiting });
    expect(isAffirmativeAssistantReply("yes")).toBe(true);
    expect(confirmed).toMatchObject({ order, orderLine: line, fulfillment, quantity: 500, timing: "today", confirmation: "confirmed" });
  });

  test("an ambiguous Order search clears active subject context rather than reusing the previous Order", () => {
    const prior = { resources: [order, line, fulfillment], capturedAt: at };
    const ambiguous = [{ toolName: "investigation.search", status: "succeeded", result: { data: { matches: [{ resource: order }, { resource: { ...order, id: "order_other", label: "Order 9002" } }] } } }];
    expect(mergeOperatorConversationResourceContext(prior, ambiguous, at)).toBeNull();
  });

  test("a new resolved Order replaces the old fulfillment subject and invalidates its prepared action", () => {
    const prior = { resources: [order, line, fulfillment], capturedAt: at };
    const pending = { action: "fulfillment_pickup" as const, order, orderLine: line, fulfillment, quantity: 500, timing: "today" as const, confirmation: "none" as const };
    const nextOrder = { type: "order" as const, id: "order_next", label: "Order 9002" };
    const next = mergeOperatorConversationResourceContext(prior, investigation({ snapshot: { resource: nextOrder } }), at)!;
    expect(next.resources).toEqual([nextOrder]);
    expect(pendingActionForCurrentResources(pending, next)).toBeNull();
  });

  test("does not invent a pickup target when no single canonical Order exists", () => {
    const context = { resources: [customer, line], capturedAt: at };
    expect(derivePendingOperatorActionContext({ message: "add another pickup of 500 today", resources: context, prior: null }))
      .toMatchObject({ order: null, orderLine: line, quantity: 500, timing: "today" });
  });
});
