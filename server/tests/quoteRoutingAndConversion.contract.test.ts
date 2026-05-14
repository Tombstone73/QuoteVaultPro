import { afterAll, beforeAll, beforeEach, describe, expect, test } from "@jest/globals";
import { and, eq, sql } from "drizzle-orm";

import { db } from "../db";
import {
  jobs,
  orderLineItems,
  orders,
  productDesignConfigs,
  products,
  quoteLineItems,
  type LineItemWorkflowState,
} from "@shared/schema";

import { QuotesRepository } from "../storage/quotes.repo";
import { OrdersRepository } from "../storage/orders.repo";
import { getLineItemDesignBriefDetail, upsertLineItemDesignBrief } from "../services/lineItemDesignBriefService";
import { transitionLineItemWorkflowState } from "../services/lineItemWorkflowService";
import { findAllActiveJobsForLineItem } from "../services/productionOwnership";

const quotesRepo = new QuotesRepository(db);
const ordersRepo = new OrdersRepository(db);

const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
const organizationId = `org_workflow_contract_${suffix}`;
const userId = `user_workflow_contract_${suffix}`;
const customerId = `cust_workflow_contract_${suffix}`;
const productId = `prod_workflow_contract_${suffix}`;
const pbv2PricingSnapshotFixture = {
  pbv2PricingSnapshot: {
    formula: "sqft * base_price * q",
    formulaVariables: { sqft: 6, base_price: 5.75, q: 1 },
    rawSelections: { thickness: "choice_3mm", sides: "choice_double" },
    effectiveSelections: { thickness: "choice_3mm", sides: "choice_double" },
    resolvedMatrixRowId: "3mm_double",
    resolvedMatrixVariables: { base_price: 5.75 },
    calculatedPrice: 34.5,
    capturedAt: "2026-05-14T00:00:00.000Z",
  },
};

beforeAll(async () => {
  await db.execute(sql`
    insert into organizations (id, name, slug)
    values (${organizationId}, ${`Workflow Contract ${suffix}`}, ${`workflow-contract-${suffix}`})
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    insert into users (id, email, role, is_admin, is_platform_admin)
    values (${userId}, ${`workflow-contract-${suffix}@example.com`}, ${"owner"}, ${true}, ${false})
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    insert into user_organizations (user_id, organization_id, role, is_default)
    values (${userId}, ${organizationId}, ${"owner"}, ${true})
    on conflict (user_id, organization_id) do nothing
  `);

  await db.execute(sql`
    insert into customers (id, organization_id, company_name, status)
    values (${customerId}, ${organizationId}, ${"Workflow Contract Customer"}, ${"active"})
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    insert into products (id, organization_id, name, description, requires_production_job)
    values (${productId}, ${organizationId}, ${"Workflow Contract Product"}, ${"contract test"}, ${true})
    on conflict (id) do nothing
  `);

  await db.insert(productDesignConfigs).values({
    organizationId,
    productId,
    requiresDesign: true,
    designBriefRequired: true,
    useKeyInstructions: true,
    useDesignObjective: true,
    useRequestedContent: false,
    useLayoutNotes: false,
    useBrandStyleNotes: false,
    useReferenceNotes: false,
    usePriorityNotes: false,
    requireKeyInstructions: true,
    requireDesignObjective: true,
    estimatedDesignMinutes: 45,
    includedDesignMinutes: 30,
    allowDesignStartWhenBriefMissing: false,
    designPricingMode: "hourly",
    flatFeeAmount: null,
    hourlyRate: "65.00",
    overageRate: "80.00",
    internalLaborRate: "32.50",
    costTrackingEnabled: true,
  });

  await db.execute(sql`
    insert into stations (organization_id, key, name, sort, active)
    values
      (${organizationId}, ${"design"}, ${"Design"}, ${10}, ${true}),
      (${organizationId}, ${"prepress"}, ${"Prepress"}, ${20}, ${true}),
      (${organizationId}, ${"roll"}, ${"Roll"}, ${30}, ${true})
    on conflict (organization_id, key) do update
    set name = excluded.name,
        sort = excluded.sort,
        active = excluded.active
  `);
});

beforeEach(() => {
  return db.execute(sql`
    insert into stations (organization_id, key, name, sort, active)
    values
      (${organizationId}, ${"design"}, ${"Design"}, ${10}, ${true}),
      (${organizationId}, ${"prepress"}, ${"Prepress"}, ${20}, ${true}),
      (${organizationId}, ${"roll"}, ${"Roll"}, ${30}, ${true})
    on conflict (organization_id, key) do update
    set name = excluded.name,
        sort = excluded.sort,
        active = excluded.active
  `);
});

afterAll(async () => {
  await db.execute(sql`delete from production_events where organization_id = ${organizationId}`);
  await db.execute(sql`delete from production_jobs where organization_id = ${organizationId}`);
  await db.execute(sql`delete from job_status_log where organization_id = ${organizationId}`);
  await db.execute(sql`
    delete from jobs
    where order_id in (select id from orders where organization_id = ${organizationId})
  `);
  await db.execute(sql`
    delete from order_line_items
    where order_id in (select id from orders where organization_id = ${organizationId})
  `);
  await db.execute(sql`delete from order_attachments where order_id in (select id from orders where organization_id = ${organizationId})`);
  await db.execute(sql`delete from order_audit_log where order_id in (select id from orders where organization_id = ${organizationId})`);
  await db.execute(sql`delete from orders where organization_id = ${organizationId}`);
  await db.execute(sql`delete from quote_attachments where organization_id = ${organizationId}`);
  await db.execute(sql`delete from quote_line_items where quote_id in (select id from quotes where organization_id = ${organizationId})`);
  await db.execute(sql`delete from quotes where organization_id = ${organizationId}`);
  await db.execute(sql`delete from audit_logs where organization_id = ${organizationId}`);
  await db.execute(sql`delete from product_design_configs where organization_id = ${organizationId}`);
  await db.execute(sql`delete from global_variables where organization_id = ${organizationId}`);
  await db.execute(sql`delete from stations where organization_id = ${organizationId}`);
  await db.execute(sql`delete from user_organizations where user_id = ${userId} and organization_id = ${organizationId}`);
  await db.execute(sql`delete from products where id = ${productId}`);
  await db.execute(sql`delete from customers where id = ${customerId}`);
  await db.execute(sql`delete from users where id = ${userId}`);
  await db.execute(sql`delete from organizations where id = ${organizationId}`);
});

function buildQuoteInput(label: string) {
  return {
    userId,
    customerId,
    contactId: null,
    customerName: "Workflow Contract Customer",
    source: "internal",
    status: "draft" as const,
    label,
    subtotal: 30,
    taxAmount: 0,
    taxableSubtotal: 30,
    totalPrice: 30,
    lineItems: [
      {
        productId,
        productName: "Workflow Contract Product A",
        variantId: null,
        variantName: null,
        productType: "wide_roll",
        width: 24,
        height: 36,
        quantity: 1,
        selectedOptions: [],
        linePrice: 10,
        priceBreakdown: {
          basePrice: 10,
          optionsPrice: 0,
          total: 10,
          formula: "contract_test",
        },
        pbv2TreeVersionId: null,
        pbv2SnapshotJson: pbv2PricingSnapshotFixture,
        pricedAt: new Date(),
        taxAmount: 0,
        isTaxableSnapshot: true,
        requiresDesign: true,
        requiresPrepress: true,
      },
      {
        productId,
        productName: "Workflow Contract Product B",
        variantId: null,
        variantName: null,
        productType: "wide_roll",
        width: 24,
        height: 36,
        quantity: 1,
        selectedOptions: [],
        linePrice: 10,
        priceBreakdown: {
          basePrice: 10,
          optionsPrice: 0,
          total: 10,
          formula: "contract_test",
        },
        pbv2TreeVersionId: null,
        pbv2SnapshotJson: {},
        pricedAt: new Date(),
        taxAmount: 0,
        isTaxableSnapshot: true,
        requiresDesign: false,
        requiresPrepress: true,
      },
      {
        productId,
        productName: "Workflow Contract Product C",
        variantId: null,
        variantName: null,
        productType: "wide_roll",
        width: 24,
        height: 36,
        quantity: 1,
        selectedOptions: [],
        linePrice: 10,
        priceBreakdown: {
          basePrice: 10,
          optionsPrice: 0,
          total: 10,
          formula: "contract_test",
        },
        pbv2TreeVersionId: null,
        pbv2SnapshotJson: {},
        pricedAt: new Date(),
        taxAmount: 0,
        isTaxableSnapshot: true,
        requiresDesign: false,
        requiresPrepress: false,
      },
    ],
  };
}

function buildPrepressOnlyQuoteInput(label: string) {
  return {
    userId,
    customerId,
    contactId: null,
    customerName: "Workflow Contract Customer",
    source: "internal",
    status: "draft" as const,
    label,
    subtotal: 10,
    taxAmount: 0,
    taxableSubtotal: 10,
    totalPrice: 10,
    lineItems: [
      {
        productId,
        productName: "Workflow Contract Prepress Only",
        variantId: null,
        variantName: null,
        productType: "wide_roll",
        width: 24,
        height: 36,
        quantity: 1,
        selectedOptions: [],
        linePrice: 10,
        priceBreakdown: {
          basePrice: 10,
          optionsPrice: 0,
          total: 10,
          formula: "contract_test",
        },
        pbv2TreeVersionId: null,
        pbv2SnapshotJson: {},
        pricedAt: new Date(),
        taxAmount: 0,
        isTaxableSnapshot: true,
        requiresDesign: false,
        requiresPrepress: true,
      },
    ],
  };
}

async function createMixedRoutingQuote(label: string) {
  return quotesRepo.createQuote(organizationId, buildQuoteInput(label) as any);
}

async function createPrepressOnlyQuote(label: string) {
  return quotesRepo.createQuote(organizationId, buildPrepressOnlyQuoteInput(label) as any);
}

async function getActiveJobs(lineItemId: string) {
  return findAllActiveJobsForLineItem(db, { organizationId, lineItemId });
}

async function getWorkflowRow(lineItemId: string) {
  const [row] = await db
    .select({
      id: orderLineItems.id,
      workflowState: orderLineItems.workflowState,
      status: orderLineItems.status,
      requiresDesign: orderLineItems.requiresDesign,
      requiresPrepress: orderLineItems.requiresPrepress,
    })
    .from(orderLineItems)
    .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
    .where(and(eq(orderLineItems.id, lineItemId), eq(orders.organizationId, organizationId)))
    .limit(1);

  return row;
}

describe("quote routing persistence and conversion contract", () => {
  test("quote line items preserve routing truth through create and edit", async () => {
    const quote = await createMixedRoutingQuote(`Persistence ${suffix}`);
    const byName = new Map(quote.lineItems.map((lineItem: any) => [lineItem.productName, lineItem]));

    expect(byName.get("Workflow Contract Product A")?.requiresDesign).toBe(true);
    expect(byName.get("Workflow Contract Product A")?.requiresDesignSnapshot).toBe(true);
    expect(byName.get("Workflow Contract Product A")?.designBriefRequiredSnapshot).toBe(true);
    expect(byName.get("Workflow Contract Product A")?.designPricingModeSnapshot).toBe("hourly");
    expect(byName.get("Workflow Contract Product A")?.hourlyRateSnapshot).toBe("65.00");
    expect(byName.get("Workflow Contract Product A")?.needsDesignOverride).toBe(null);
    expect(byName.get("Workflow Contract Product A")?.requiresPrepress).toBe(true);
    expect(byName.get("Workflow Contract Product B")?.requiresDesign).toBe(false);
    expect(byName.get("Workflow Contract Product B")?.requiresDesignSnapshot).toBe(true);
    expect(byName.get("Workflow Contract Product B")?.needsDesignOverride).toBe(false);
    expect(byName.get("Workflow Contract Product B")?.requiresPrepress).toBe(true);
    expect(byName.get("Workflow Contract Product C")?.requiresDesign).toBe(false);
    expect(byName.get("Workflow Contract Product C")?.requiresDesignSnapshot).toBe(true);
    expect(byName.get("Workflow Contract Product C")?.needsDesignOverride).toBe(false);
    expect(byName.get("Workflow Contract Product C")?.requiresPrepress).toBe(false);

    const lineItemB = byName.get("Workflow Contract Product B");
    expect(lineItemB).toBeDefined();

    const updated = await quotesRepo.updateLineItem(String(lineItemB!.id), {
      requiresDesign: true,
      requiresPrepress: false,
    } as any);

    expect(updated.requiresDesign).toBe(true);
    expect(updated.requiresDesignSnapshot).toBe(true);
    expect(updated.needsDesignOverride).toBe(null);
    expect(updated.requiresPrepress).toBe(false);
  });

  test("quote to order conversion reconciles mixed routing into workflow state and ownership", async () => {
    const quote = await createMixedRoutingQuote(`Conversion ${suffix}`);
    const createdOrder = await ordersRepo.convertQuoteToOrder(organizationId, quote.id, userId);

    const lineItemsByQuoteLineItemId = new Map(
      createdOrder.lineItems.map((lineItem: any) => [lineItem.quoteLineItemId, lineItem]),
    );

    const quoteItemA = quote.lineItems.find((lineItem: any) => lineItem.productName.endsWith("A"));
    const quoteItemB = quote.lineItems.find((lineItem: any) => lineItem.productName.endsWith("B"));
    const quoteItemC = quote.lineItems.find((lineItem: any) => lineItem.productName.endsWith("C"));

    const itemA = lineItemsByQuoteLineItemId.get(quoteItemA!.id);
    const itemB = lineItemsByQuoteLineItemId.get(quoteItemB!.id);
    const itemC = lineItemsByQuoteLineItemId.get(quoteItemC!.id);

    expect(itemA?.workflowState).toBe("needs_design");
    expect(itemA?.pbv2SnapshotJson).toEqual(pbv2PricingSnapshotFixture);
    expect(itemA?.requiresDesignSnapshot).toBe(true);
    expect(itemA?.designPricingModeSnapshot).toBe("hourly");
    expect(itemA?.hourlyRateSnapshot).toBe("65.00");
    expect(itemA?.needsDesignOverride).toBe(null);
    expect(itemB?.workflowState).toBe("ready_for_prepress");
    expect(itemB?.requiresDesignSnapshot).toBe(true);
    expect(itemB?.needsDesignOverride).toBe(false);
    expect(itemC?.workflowState).toBe("ready_for_production");
    expect(itemC?.requiresDesignSnapshot).toBe(true);
    expect(itemC?.needsDesignOverride).toBe(false);

    const activeJobsA = await getActiveJobs(String(itemA!.id));
    const activeJobsB = await getActiveJobs(String(itemB!.id));
    const activeJobsC = await getActiveJobs(String(itemC!.id));

    expect(activeJobsA).toHaveLength(1);
    expect(activeJobsA[0].stationKey).toBe("design");
    expect(activeJobsA[0].stepKey).toBe("design");

    expect(activeJobsB).toHaveLength(1);
    expect(activeJobsB[0].stationKey).toBe("prepress");
    expect(activeJobsB[0].stepKey).toBe("prepress");

    expect(activeJobsC).toHaveLength(1);
    expect(activeJobsC[0].stationKey).toBe("roll");
    expect(activeJobsC[0].stepKey).toBe("queued");

    await db.transaction(async (tx) => {
      await transitionLineItemWorkflowState(tx, {
        organizationId,
        lineItemId: String(itemA!.id),
        toState: "on_hold",
        actorUserId: userId,
        metadata: { source: "jest_contract_ownerless" },
      });
    });

    expect(await getActiveJobs(String(itemA!.id))).toHaveLength(0);

  });

  test("fail-closed downstream resolution leaves workflow state and ownership untouched", async () => {
    const quote = await createPrepressOnlyQuote(`Fail closed ${suffix}`);
    const createdOrder = await ordersRepo.convertQuoteToOrder(organizationId, quote.id, userId);
    const itemB = createdOrder.lineItems[0];

    expect(itemB).toBeDefined();

    const beforeRow = await getWorkflowRow(String(itemB!.id));
    const beforeJobs = await getActiveJobs(String(itemB!.id));

    await db.execute(sql`
      update stations
      set key = ${`roll_unavailable_${suffix}`}
      where organization_id = ${organizationId}
        and key = ${"roll"}
    `);

    await expect(
      db.transaction(async (tx) => {
        await transitionLineItemWorkflowState(tx, {
          organizationId,
          lineItemId: String(itemB!.id),
          toState: "ready_for_production" as LineItemWorkflowState,
          actorUserId: userId,
          metadata: { source: "jest_fail_closed" },
        });
      }),
    ).rejects.toThrow(/station row not found/i);

    const afterRow = await getWorkflowRow(String(itemB!.id));
    const afterJobs = await getActiveJobs(String(itemB!.id));

    expect(beforeRow?.workflowState).toBe("ready_for_prepress");
    expect(afterRow?.workflowState).toBe("ready_for_prepress");
    expect(afterJobs).toHaveLength(1);
    expect(beforeJobs).toHaveLength(1);
    expect(afterJobs[0].id).toBe(beforeJobs[0].id);
    expect(afterJobs[0].stationKey).toBe("prepress");
    expect(afterJobs[0].stepKey).toBe("prepress");
  });

  test("manual order line creation snapshots current product design config", async () => {
    const createdOrder = await ordersRepo.createOrder(organizationId, {
      customerId,
      createdByUserId: userId,
      lineItems: [
        {
          productId,
          productType: "wide_roll",
          description: "Manual order line snapshot",
          width: 12,
          height: 18,
          quantity: 1,
          unitPrice: 25,
          totalPrice: 25,
          status: "new",
          requiresDesign: false,
          requiresPrepress: true,
          selectedOptions: [],
        },
      ],
    } as any);

    const createdLine = createdOrder.lineItems[0] as any;
    expect(createdLine.requiresDesignSnapshot).toBe(true);
    expect(createdLine.designBriefRequiredSnapshot).toBe(true);
    expect(createdLine.designPricingModeSnapshot).toBe("hourly");
    expect(createdLine.hourlyRateSnapshot).toBe("65.00");
    expect(createdLine.needsDesignOverride).toBe(false);
    expect(createdLine.requiresDesign).toBe(false);
  });

  test("design brief detail returns required_missing before save and captured after save", async () => {
    const quote = await createMixedRoutingQuote(`Design brief ${suffix}`);
    const createdOrder = await ordersRepo.convertQuoteToOrder(organizationId, quote.id, userId);
    const designLine = createdOrder.lineItems.find((lineItem: any) => lineItem.description?.includes("Product A"));

    expect(designLine).toBeDefined();

    const initialDetail = await getLineItemDesignBriefDetail({
      organizationId,
      orderId: String(createdOrder.id),
      orderLineItemId: String(designLine!.id),
    });

    expect(initialDetail).not.toBeNull();
    expect(initialDetail?.id).toBeNull();
    expect(initialDetail?.effectiveRequiresDesign).toBe(true);
    expect(initialDetail?.designBriefRequired).toBe(true);
    expect(initialDetail?.status).toBe("required_missing");

    const savedDetail = await upsertLineItemDesignBrief({
      organizationId,
      orderId: String(createdOrder.id),
      orderLineItemId: String(designLine!.id),
      userId,
      values: {
        keyInstructions: "  Use the spring promo headline prominently.  ",
        designObjective: "Drive walk-in conversions with a bold call to action.",
        requestedContent: "Logo, phone, QR code",
      },
    });

    expect(savedDetail).not.toBeNull();
    expect(savedDetail?.id).toBeTruthy();
    expect(savedDetail?.keyInstructions).toBe("Use the spring promo headline prominently.");
    expect(savedDetail?.designObjective).toBe("Drive walk-in conversions with a bold call to action.");
    expect(savedDetail?.status).toBe("captured");

    const updatedDetail = await upsertLineItemDesignBrief({
      organizationId,
      orderId: String(createdOrder.id),
      orderLineItemId: String(designLine!.id),
      userId,
      values: {
        keyInstructions: "Use the spring promo headline prominently.",
        designObjective: "Drive walk-in conversions with a bold call to action.",
        priorityNotes: "Rush for Friday pickup",
      },
    });

    expect(updatedDetail?.id).toBe(savedDetail?.id);
    expect(updatedDetail?.priorityNotes).toBe("Rush for Friday pickup");
    expect(updatedDetail?.status).toBe("captured");
  });

  test("design brief status becomes not_required when override disables design", async () => {
    const quote = await createMixedRoutingQuote(`Design brief override ${suffix}`);
    const createdOrder = await ordersRepo.convertQuoteToOrder(organizationId, quote.id, userId);
    const designLine = createdOrder.lineItems.find((lineItem: any) => lineItem.description?.includes("Product A"));

    expect(designLine).toBeDefined();

    await db
      .update(orderLineItems)
      .set({
        needsDesignOverride: false,
        requiresDesign: false,
      })
      .where(eq(orderLineItems.id, String(designLine!.id)));

    const detail = await getLineItemDesignBriefDetail({
      organizationId,
      orderId: String(createdOrder.id),
      orderLineItemId: String(designLine!.id),
    });

    expect(detail).not.toBeNull();
    expect(detail?.effectiveRequiresDesign).toBe(false);
    expect(detail?.designBriefRequired).toBe(false);
    expect(detail?.status).toBe("not_required");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Blocker #1: requiresProofApproval snapshot integrity
// ─────────────────────────────────────────────────────────────────────────────
describe("requiresProofApproval snapshot integrity", () => {
  const proofProductId = `prod_proof_snapshot_${suffix}`;

  beforeAll(async () => {
    // Create a product with requiresProofApproval = true
    await db.execute(sql`
      insert into products (id, organization_id, name, description, requires_proof_approval)
      values (${proofProductId}, ${organizationId}, ${"Proof Product"}, ${"proof snapshot test"}, ${true})
      on conflict (id) do update set requires_proof_approval = excluded.requires_proof_approval
    `);
  });

  afterAll(async () => {
    await db.execute(sql`delete from products where id = ${proofProductId}`);
  });

  test("quote line item snapshots requiresProofApproval from product at creation time", async () => {
    const quote = await quotesRepo.createQuote(organizationId, {
      userId,
      customerId,
      contactId: null,
      customerName: "Proof Snapshot Customer",
      source: "internal",
      status: "draft",
      label: `ProofSnapshot ${suffix}`,
      subtotal: 10,
      taxAmount: 0,
      taxableSubtotal: 10,
      totalPrice: 10,
      lineItems: [
        {
          productId: proofProductId,
          productName: "Proof Product",
          variantId: null,
          variantName: null,
          productType: "wide_roll",
          width: 12,
          height: 18,
          quantity: 1,
          selectedOptions: [],
          linePrice: 10,
          priceBreakdown: { basePrice: 10, optionsPrice: 0, total: 10, formula: "test" },
          pbv2TreeVersionId: null,
          pbv2SnapshotJson: {},
          pricedAt: new Date(),
          taxAmount: 0,
          isTaxableSnapshot: true,
          requiresDesign: false,
          requiresPrepress: true,
        } as any,
      ],
    } as any);

    const qli = quote.lineItems[0] as any;
    expect(qli.requiresProofApproval).toBe(true);
  });

  test("quote-to-order conversion uses snapshot, not live product, for requiresProofApproval", async () => {
    // Create quote while product still has requiresProofApproval = true
    const quote = await quotesRepo.createQuote(organizationId, {
      userId,
      customerId,
      contactId: null,
      customerName: "Proof Snapshot Customer",
      source: "internal",
      status: "draft",
      label: `ProofConvert ${suffix}`,
      subtotal: 10,
      taxAmount: 0,
      taxableSubtotal: 10,
      totalPrice: 10,
      lineItems: [
        {
          productId: proofProductId,
          productName: "Proof Product",
          variantId: null,
          variantName: null,
          productType: "wide_roll",
          width: 12,
          height: 18,
          quantity: 1,
          selectedOptions: [],
          linePrice: 10,
          priceBreakdown: { basePrice: 10, optionsPrice: 0, total: 10, formula: "test" },
          pbv2TreeVersionId: null,
          pbv2SnapshotJson: {},
          pricedAt: new Date(),
          taxAmount: 0,
          isTaxableSnapshot: true,
          requiresDesign: false,
          requiresPrepress: true,
        } as any,
      ],
    } as any);

    // Mutate the product — disable proof approval AFTER quoting
    await db
      .update(products)
      .set({ requiresProofApproval: false })
      .where(eq(products.id, proofProductId));

    // Convert: the order line item must reflect the SNAPSHOT (true), not the mutated product (false)
    const createdOrder = await ordersRepo.convertQuoteToOrder(organizationId, quote.id, userId);
    const oli = createdOrder.lineItems[0] as any;

    expect(oli.requiresProofApproval).toBe(true);
    expect(oli.workflowState).toBe("awaiting_proof_approval");

    // Restore product for subsequent tests
    await db
      .update(products)
      .set({ requiresProofApproval: true })
      .where(eq(products.id, proofProductId));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Blocker #2: proof gate enforcement
// ─────────────────────────────────────────────────────────────────────────────
describe("proof gate enforcement", () => {
  const proofGateProductId = `prod_proof_gate_${suffix}`;

  beforeAll(async () => {
    await db.execute(sql`
      insert into products (id, organization_id, name, description, requires_proof_approval)
      values (${proofGateProductId}, ${organizationId}, ${"Proof Gate Product"}, ${"proof gate test"}, ${true})
      on conflict (id) do update set requires_proof_approval = excluded.requires_proof_approval
    `);
  });

  afterAll(async () => {
    await db.execute(sql`delete from products where id = ${proofGateProductId}`);
  });

  test("proof-required line item starts in awaiting_proof_approval when design is not required", async () => {
    const quote = await quotesRepo.createQuote(organizationId, {
      userId,
      customerId,
      contactId: null,
      customerName: "Proof Gate Customer",
      source: "internal",
      status: "draft",
      label: `ProofGate ${suffix}`,
      subtotal: 10,
      taxAmount: 0,
      taxableSubtotal: 10,
      totalPrice: 10,
      lineItems: [
        {
          productId: proofGateProductId,
          productName: "Proof Gate Product",
          variantId: null,
          variantName: null,
          productType: "wide_roll",
          width: 12,
          height: 18,
          quantity: 1,
          selectedOptions: [],
          linePrice: 10,
          priceBreakdown: { basePrice: 10, optionsPrice: 0, total: 10, formula: "test" },
          pbv2TreeVersionId: null,
          pbv2SnapshotJson: {},
          pricedAt: new Date(),
          taxAmount: 0,
          isTaxableSnapshot: true,
          requiresDesign: false,
          requiresPrepress: true,
        } as any,
      ],
    } as any);

    const createdOrder = await ordersRepo.convertQuoteToOrder(organizationId, quote.id, userId);
    const oli = createdOrder.lineItems[0] as any;

    expect(oli.requiresProofApproval).toBe(true);
    expect(oli.workflowState).toBe("awaiting_proof_approval");
    expect(oli.approvedProofVersionId).toBeNull();
  });

  test("transition to ready_for_prepress is blocked without approved proof", async () => {
    const quote = await quotesRepo.createQuote(organizationId, {
      userId,
      customerId,
      contactId: null,
      customerName: "Proof Gate Customer",
      source: "internal",
      status: "draft",
      label: `ProofBlock ${suffix}`,
      subtotal: 10,
      taxAmount: 0,
      taxableSubtotal: 10,
      totalPrice: 10,
      lineItems: [
        {
          productId: proofGateProductId,
          productName: "Proof Gate Product",
          variantId: null,
          variantName: null,
          productType: "wide_roll",
          width: 12,
          height: 18,
          quantity: 1,
          selectedOptions: [],
          linePrice: 10,
          priceBreakdown: { basePrice: 10, optionsPrice: 0, total: 10, formula: "test" },
          pbv2TreeVersionId: null,
          pbv2SnapshotJson: {},
          pricedAt: new Date(),
          taxAmount: 0,
          isTaxableSnapshot: true,
          requiresDesign: false,
          requiresPrepress: true,
        } as any,
      ],
    } as any);

    const createdOrder = await ordersRepo.convertQuoteToOrder(organizationId, quote.id, userId);
    const oli = createdOrder.lineItems[0] as any;
    expect(oli.workflowState).toBe("awaiting_proof_approval");

    // Attempt to advance without an approved proof — must throw
    await expect(
      db.transaction(async (tx) => {
        await transitionLineItemWorkflowState(tx, {
          organizationId,
          lineItemId: String(oli.id),
          toState: "ready_for_prepress" as LineItemWorkflowState,
          actorUserId: userId,
        });
      }),
    ).rejects.toThrow(/approved proof is required/i);
  });

  test("transition to ready_for_prepress succeeds after approvedProofVersionId is set", async () => {
    const quote = await quotesRepo.createQuote(organizationId, {
      userId,
      customerId,
      contactId: null,
      customerName: "Proof Gate Customer",
      source: "internal",
      status: "draft",
      label: `ProofApprove ${suffix}`,
      subtotal: 10,
      taxAmount: 0,
      taxableSubtotal: 10,
      totalPrice: 10,
      lineItems: [
        {
          productId: proofGateProductId,
          productName: "Proof Gate Product",
          variantId: null,
          variantName: null,
          productType: "wide_roll",
          width: 12,
          height: 18,
          quantity: 1,
          selectedOptions: [],
          linePrice: 10,
          priceBreakdown: { basePrice: 10, optionsPrice: 0, total: 10, formula: "test" },
          pbv2TreeVersionId: null,
          pbv2SnapshotJson: {},
          pricedAt: new Date(),
          taxAmount: 0,
          isTaxableSnapshot: true,
          requiresDesign: false,
          requiresPrepress: true,
        } as any,
      ],
    } as any);

    const createdOrder = await ordersRepo.convertQuoteToOrder(organizationId, quote.id, userId);
    const oli = createdOrder.lineItems[0] as any;

    // Directly stamp a synthetic approvedProofVersionId to simulate proof approval
    const syntheticProofId = `proof_synthetic_${suffix}`;
    await db
      .update(orderLineItems)
      .set({ approvedProofVersionId: syntheticProofId })
      .where(eq(orderLineItems.id, String(oli.id)));

    // Now transition should succeed
    await expect(
      db.transaction(async (tx) => {
        await transitionLineItemWorkflowState(tx, {
          organizationId,
          lineItemId: String(oli.id),
          toState: "ready_for_prepress" as LineItemWorkflowState,
          actorUserId: userId,
        });
      }),
    ).resolves.toMatchObject({ toState: "ready_for_prepress" });

    const [afterRow] = await db
      .select({ workflowState: orderLineItems.workflowState })
      .from(orderLineItems)
      .where(eq(orderLineItems.id, String(oli.id)));
    expect(afterRow?.workflowState).toBe("ready_for_prepress");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Blocker #3: production job creation rules
// ─────────────────────────────────────────────────────────────────────────────
describe("production job creation rules", () => {
  const jobRulesProductId = `prod_job_rules_${suffix}`;

  beforeAll(async () => {
    await db.execute(sql`
      insert into products (id, organization_id, name, description, requires_proof_approval, requires_production_job)
      values (${jobRulesProductId}, ${organizationId}, ${"Job Rules Product"}, ${"job creation rules test"}, ${true}, ${true})
      on conflict (id) do update
        set requires_proof_approval = excluded.requires_proof_approval,
            requires_production_job  = excluded.requires_production_job
    `);
  });

  afterAll(async () => {
    await db.execute(sql`delete from products where id = ${jobRulesProductId}`);
  });

  test("quote-to-order conversion does NOT create a legacy jobs record for proof-required items", async () => {
    const quote = await quotesRepo.createQuote(organizationId, {
      userId,
      customerId,
      contactId: null,
      customerName: "Job Rules Customer",
      source: "internal",
      status: "draft",
      label: `JobRulesProof ${suffix}`,
      subtotal: 10,
      taxAmount: 0,
      taxableSubtotal: 10,
      totalPrice: 10,
      lineItems: [
        {
          productId: jobRulesProductId,
          productName: "Job Rules Product",
          variantId: null,
          variantName: null,
          productType: "wide_roll",
          width: 12,
          height: 18,
          quantity: 1,
          selectedOptions: [],
          linePrice: 10,
          priceBreakdown: { basePrice: 10, optionsPrice: 0, total: 10, formula: "test" },
          pbv2TreeVersionId: null,
          pbv2SnapshotJson: {},
          pricedAt: new Date(),
          taxAmount: 0,
          isTaxableSnapshot: true,
          requiresDesign: false,
          requiresPrepress: true,
        } as any,
      ],
    } as any);

    const createdOrder = await ordersRepo.convertQuoteToOrder(organizationId, quote.id, userId);
    const oli = createdOrder.lineItems[0] as any;

    expect(oli.workflowState).toBe("awaiting_proof_approval");

    const legacyJobs = await db
      .select()
      .from(jobs)
      .where(eq(jobs.orderLineItemId as any, String(oli.id)));

    expect(legacyJobs).toHaveLength(0);
  });

  test("quote-to-order conversion does NOT create a legacy jobs record for design-required items", async () => {
    const quote = await createMixedRoutingQuote(`JobRulesDesign ${suffix}`);
    const createdOrder = await ordersRepo.convertQuoteToOrder(organizationId, quote.id, userId);

    const designItem = createdOrder.lineItems.find((li: any) => li.workflowState === "needs_design");
    expect(designItem).toBeDefined();

    const legacyJobs = await db
      .select()
      .from(jobs)
      .where(eq(jobs.orderLineItemId as any, String(designItem!.id)));

    expect(legacyJobs).toHaveLength(0);
  });

  test("quote-to-order conversion DOES create a legacy jobs record for immediately production-ready items", async () => {
    const quote = await quotesRepo.createQuote(organizationId, {
      userId,
      customerId,
      contactId: null,
      customerName: "Job Rules Customer",
      source: "internal",
      status: "draft",
      label: `JobRulesReady ${suffix}`,
      subtotal: 10,
      taxAmount: 0,
      taxableSubtotal: 10,
      totalPrice: 10,
      lineItems: [
        {
          productId,
          productName: "Ready Item",
          variantId: null,
          variantName: null,
          productType: "wide_roll",
          width: 12,
          height: 18,
          quantity: 1,
          selectedOptions: [],
          linePrice: 10,
          priceBreakdown: { basePrice: 10, optionsPrice: 0, total: 10, formula: "test" },
          pbv2TreeVersionId: null,
          pbv2SnapshotJson: {},
          pricedAt: new Date(),
          taxAmount: 0,
          isTaxableSnapshot: true,
          requiresDesign: false,
          requiresPrepress: false,
        } as any,
      ],
    } as any);

    const createdOrder = await ordersRepo.convertQuoteToOrder(organizationId, quote.id, userId);
    const oli = createdOrder.lineItems[0] as any;

    expect(oli.workflowState).toBe("ready_for_production");

    const legacyJobs = await db
      .select()
      .from(jobs)
      .where(eq(jobs.orderLineItemId as any, String(oli.id)));

    expect(legacyJobs).toHaveLength(1);
    expect(legacyJobs[0].statusKey).toBe("new");
  });
});
