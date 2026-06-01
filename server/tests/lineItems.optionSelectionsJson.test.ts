import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { db } from '../db';
import { storage } from '../storage';
import { organizations, userOrganizations, users, products, quotes, quoteLineItems } from '@shared/schema';
import { eq, and } from 'drizzle-orm';

function createTestApp(opts: { organizationId: string; userId: string }) {
  const app = express();
  app.use(express.json());

  // Minimal auth/org context injection (avoid full localAuth/replitAuth wiring)
  app.use((req: any, _res, next) => {
    req.user = { id: opts.userId, role: 'employee' };
    req.organizationId = opts.organizationId;
    next();
  });

  // Minimal handlers that mirror the production response shapes
  app.post('/api/quotes/:id/line-items', async (req: any, res) => {
    const { id } = req.params;
    const created = await storage.addLineItem(id, req.body);
    res.json(created);
  });

  app.patch('/api/quotes/:id/line-items/:lineItemId', async (req: any, res) => {
    const { lineItemId } = req.params;
    const updated = await storage.updateLineItem(lineItemId, req.body);
    res.json(updated);
  });

  app.post('/api/line-items/temp', async (req: any, res) => {
    const created = await storage.createTemporaryLineItem(opts.organizationId, opts.userId, req.body);
    res.json({ success: true, data: created });
  });

  return app;
}

describe('Line item optionSelectionsJson echo + snapshot carry', () => {
  const orgId = `org_test_opts_${Date.now()}`;
  const userId = `user_test_opts_${Date.now()}`;
  const slug = `test-opts-${Date.now()}`;

  let productId = '';
  let quoteId = '';

  beforeAll(async () => {
    await db.insert(organizations).values({ id: orgId, name: 'Test Org (optionSelectionsJson)', slug });
    await db.insert(users).values({ id: userId, email: `${slug}@example.com`, role: 'employee', isAdmin: true });
    await db.insert(userOrganizations).values({ userId, organizationId: orgId, role: 'owner', isDefault: true });

    const [p] = await db
      .insert(products)
      .values({
        organizationId: orgId,
        name: 'Test Product (optionSelectionsJson)',
        description: 'Test product for line item optionSelectionsJson regression test',
        pricingProfileKey: 'default',
        pricingFormula: '1',
        pricingMode: 'flat',
        isTaxable: true,
        isActive: true,
      } as any)
      .returning();

    productId = p.id;

    const [q] = await db
      .insert(quotes)
      .values({
        organizationId: orgId,
        userId,
        status: 'active',
        source: 'internal',
        subtotal: '0',
        taxAmount: '0',
        taxableSubtotal: '0',
        marginPercentage: '0',
        discountAmount: '0',
        totalPrice: '0',
      } as any)
      .returning();

    quoteId = q.id;
  });

  afterAll(async () => {
    // Best-effort cleanup
    try {
      await db.delete(quotes).where(eq(quotes.id, quoteId));
    } catch {}
    try {
      await db.delete(products).where(eq(products.id, productId));
    } catch {}
    try {
      await db.delete(userOrganizations).where(and(eq(userOrganizations.userId, userId), eq(userOrganizations.organizationId, orgId)));
    } catch {}
    try {
      await db.delete(users).where(eq(users.id, userId));
    } catch {}
    try {
      await db.delete(organizations).where(eq(organizations.id, orgId));
    } catch {}
  });

  test('POST /api/quotes/:id/line-items echoes optionSelectionsJson', async () => {
    const app = createTestApp({ organizationId: orgId, userId });
    const optionSelectionsJson = {
      schemaVersion: 2,
      selected: {
        node_1: { value: true },
        node_2: { value: 'abc', note: 'hello' },
      },
    };

    const body = {
      productId,
      productName: 'Test LI',
      variantId: null,
      variantName: null,
      productType: 'wide_roll',
      status: 'active',
      width: 10,
      height: 5,
      quantity: 2,
      specsJson: { notes: 'x' },
      optionSelectionsJson,
      selectedOptions: [],
      linePrice: 1,
      priceBreakdown: { basePrice: 1, optionsPrice: 0, total: 1, formula: '' },
      displayOrder: 0,
      isTemporary: false,
    };

    const res = await request(app).post(`/api/quotes/${quoteId}/line-items`).send(body);
    expect(res.status).toBe(200);
    expect(res.body.optionSelectionsJson).toEqual(optionSelectionsJson);
  });

  test('PATCH /api/quotes/:id/line-items/:lineItemId echoes optionSelectionsJson', async () => {
    const app = createTestApp({ organizationId: orgId, userId });

    const initialSelections = { schemaVersion: 2, selected: { node_1: { value: true } } };
    const createRes = await request(app)
      .post(`/api/quotes/${quoteId}/line-items`)
      .send({
        productId,
        productName: 'Test LI 2',
        productType: 'wide_roll',
        status: 'active',
        width: 10,
        height: 5,
        quantity: 2,
        specsJson: null,
        optionSelectionsJson: initialSelections,
        selectedOptions: [],
        linePrice: 1,
        priceBreakdown: { basePrice: 1, optionsPrice: 0, total: 1, formula: '' },
        displayOrder: 0,
        isTemporary: false,
      });

    expect(createRes.status).toBe(200);
    const lineItemId = createRes.body.id;

    const updatedSelections = { schemaVersion: 2, selected: { node_1: { value: false }, node_3: { value: 123 } } };
    const patchRes = await request(app)
      .patch(`/api/quotes/${quoteId}/line-items/${lineItemId}`)
      .send({ optionSelectionsJson: updatedSelections });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.optionSelectionsJson).toEqual(updatedSelections);
  });

  test('POST /api/line-items/temp echoes optionSelectionsJson inside data', async () => {
    const app = createTestApp({ organizationId: orgId, userId });

    const optionSelectionsJson = {
      schemaVersion: 2,
      selected: { node_a: { value: true } },
    };

    const res = await request(app).post('/api/line-items/temp').send({
      productId,
      productName: 'Temp LI',
      variantId: null,
      variantName: null,
      productType: 'wide_roll',
      status: 'active',
      width: 10,
      height: 5,
      quantity: 2,
      specsJson: null,
      optionSelectionsJson,
      selectedOptions: [],
      linePrice: 1,
      priceBreakdown: { basePrice: 1, optionsPrice: 0, total: 1, formula: '' },
      displayOrder: 0,
    });

    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);
    expect(res.body?.data?.optionSelectionsJson).toEqual(optionSelectionsJson);
  });

  test('PATCH route-shaped total override persists specsJson priceOverride and reload hydrates it', async () => {
    const app = createTestApp({ organizationId: orgId, userId });

    const createRes = await request(app)
      .post(`/api/quotes/${quoteId}/line-items`)
      .send({
        productId,
        productName: 'Test LI Override Total',
        productType: 'wide_roll',
        status: 'active',
        width: 10,
        height: 5,
        quantity: 3,
        specsJson: {},
        optionSelectionsJson: null,
        selectedOptions: [],
        linePrice: 8.88,
        priceBreakdown: { basePrice: 8.88, optionsPrice: 0, total: 8.88, formula: '' },
        displayOrder: 0,
        isTemporary: false,
      });

    expect(createRes.status).toBe(200);
    const lineItemId = createRes.body.id;
    const routePreparedSpecsJson = {
      priceOverride: {
        schemaVersion: 1,
        mode: 'override_total_after_margin',
        valueCents: 4000,
        valuePercent: null,
        baseCalculatedUnitPriceCents: 296,
        baseCalculatedTotalCents: 888,
        effectiveUnitPriceCents: 1333,
        effectiveTotalCents: 4000,
        appliedAt: '2026-06-01T14:15:28.462Z',
      },
    };

    const patchRes = await request(app)
      .patch(`/api/quotes/${quoteId}/line-items/${lineItemId}`)
      .send({
        specsJson: routePreparedSpecsJson,
        linePrice: 40,
        formulaLinePrice: 8.88,
        priceBreakdown: { basePrice: 8.88, optionsPrice: 0, total: 40, formula: '' },
        overridePriceCents: 4000,
        overrideAt: '2026-06-01T14:15:28.462Z',
        overrideByUserId: userId,
      });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.priceOverride).toEqual(expect.objectContaining({
      mode: 'override_total_after_margin',
      valueCents: 4000,
      effectiveTotalCents: 4000,
    }));
    expect(patchRes.body.overridePriceCents).toBe(4000);
    expect(Number(patchRes.body.linePrice)).toBe(40);

    const [row] = await db.select().from(quoteLineItems).where(eq(quoteLineItems.id, lineItemId));
    expect((row.specsJson as any)?.priceOverride).toEqual(expect.objectContaining({
      mode: 'override_total_after_margin',
      valueCents: 4000,
      effectiveTotalCents: 4000,
    }));
    expect(row.priceOverride).toBeNull();

    const reloadedQuote = await storage.getQuoteById(orgId, quoteId);
    const reloadedLineItem = reloadedQuote?.lineItems?.find((item: any) => item.id === lineItemId) as any;
    expect(reloadedLineItem?.priceOverride).toEqual(expect.objectContaining({
      mode: 'override_total_after_margin',
      valueCents: 4000,
      effectiveTotalCents: 4000,
    }));
    expect(reloadedLineItem?.overridePriceCents).toBe(4000);
    expect(Number(reloadedLineItem?.linePrice)).toBe(40);
  });

  test('PATCH route-shaped unit and explicit zero overrides persist, and revert clears specsJson priceOverride', async () => {
    const app = createTestApp({ organizationId: orgId, userId });

    const createRes = await request(app)
      .post(`/api/quotes/${quoteId}/line-items`)
      .send({
        productId,
        productName: 'Test LI Override Unit Zero',
        productType: 'wide_roll',
        status: 'active',
        width: 10,
        height: 5,
        quantity: 3,
        specsJson: {},
        optionSelectionsJson: null,
        selectedOptions: [],
        linePrice: 8.88,
        priceBreakdown: { basePrice: 8.88, optionsPrice: 0, total: 8.88, formula: '' },
        displayOrder: 0,
        isTemporary: false,
      });

    expect(createRes.status).toBe(200);
    const lineItemId = createRes.body.id;

    const unitPatchRes = await request(app)
      .patch(`/api/quotes/${quoteId}/line-items/${lineItemId}`)
      .send({
        specsJson: {
          priceOverride: {
            schemaVersion: 1,
            mode: 'override_unit_after_margin',
            valueCents: 1000,
            valuePercent: null,
            baseCalculatedUnitPriceCents: 296,
            baseCalculatedTotalCents: 888,
            effectiveUnitPriceCents: 1000,
            effectiveTotalCents: 3000,
            appliedAt: '2026-06-01T14:15:28.462Z',
          },
        },
        linePrice: 30,
        formulaLinePrice: 8.88,
        priceBreakdown: { basePrice: 8.88, optionsPrice: 0, total: 30, formula: '' },
        overridePriceCents: 3000,
      });

    expect(unitPatchRes.status).toBe(200);
    expect(unitPatchRes.body.priceOverride).toEqual(expect.objectContaining({
      mode: 'override_unit_after_margin',
      valueCents: 1000,
      effectiveTotalCents: 3000,
    }));
    expect(unitPatchRes.body.overridePriceCents).toBe(3000);

    const zeroPatchRes = await request(app)
      .patch(`/api/quotes/${quoteId}/line-items/${lineItemId}`)
      .send({
        specsJson: {
          priceOverride: {
            schemaVersion: 1,
            mode: 'override_total_after_margin',
            valueCents: 0,
            valuePercent: null,
            baseCalculatedUnitPriceCents: 296,
            baseCalculatedTotalCents: 888,
            effectiveUnitPriceCents: 0,
            effectiveTotalCents: 0,
            appliedAt: '2026-06-01T14:15:28.462Z',
          },
        },
        linePrice: 0,
        formulaLinePrice: 8.88,
        priceBreakdown: { basePrice: 8.88, optionsPrice: 0, total: 0, formula: '' },
        overridePriceCents: 0,
      });

    expect(zeroPatchRes.status).toBe(200);
    expect(zeroPatchRes.body.priceOverride).toEqual(expect.objectContaining({
      mode: 'override_total_after_margin',
      valueCents: 0,
      effectiveTotalCents: 0,
    }));
    expect(zeroPatchRes.body.overridePriceCents).toBe(0);

    const revertRes = await request(app)
      .patch(`/api/quotes/${quoteId}/line-items/${lineItemId}`)
      .send({
        priceOverride: null,
        priceOverrideMode: null,
        priceOverrideValueCents: null,
        overridePriceCents: null,
      });

    expect(revertRes.status).toBe(200);
    expect(revertRes.body.priceOverride).toBeNull();
    expect(revertRes.body.overridePriceCents).toBeNull();
    expect(Number(revertRes.body.linePrice)).toBe(8.88);

    const [row] = await db.select().from(quoteLineItems).where(eq(quoteLineItems.id, lineItemId));
    expect((row.specsJson as any)?.priceOverride).toBeUndefined();
    expect(row.overridePriceCents).toBeNull();
    expect(row.priceOverride).toBeNull();
  });
});
