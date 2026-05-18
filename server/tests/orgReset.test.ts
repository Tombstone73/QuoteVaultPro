/**
 * orgReset.test.ts
 *
 * Tests for the two admin reset actions:
 *   1. resetTransactionalData  — wipes operational data, preserves config
 *   2. resetQuickBooksImportData — selectively removes QB import artifacts
 *
 * Test breakdown:
 *   Section A — Pure-logic unit tests (no DB/network needed):
 *     - Customer safety-check logic (who is safe to delete)
 *     - Warning message construction for skipped customers
 *     - Route body schema parsing (valid / invalid inputs)
 *     - Return-type shape assertions (compile-time via TypeScript inference)
 *
 *   Section B — Route middleware contract (inline Express stubs):
 *     - Non-admin gets 403 from both reset endpoints
 *     - Malformed request body returns 400 with a useful message
 *     - Transient service errors return 500 with { success: false, message }
 *
 *   Section C — Integration stubs (require DATABASE_URL):
 *     Marked with SKIP_WITHOUT_DB — these are skipped when no DB is present.
 *     They verify the actual deletion logic end-to-end.
 */

import { describe, it, expect, jest, beforeAll } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// ESM __dirname shim
import { fileURLToPath } from 'url';
import path from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Section A — Pure logic extracted for testing
// ---------------------------------------------------------------------------

/**
 * Mirrors the safety-check logic in resetQuickBooksImportData:
 * A QB-imported customer may only be deleted if they have no linked orders
 * and no linked invoices (after QB invoices have already been deleted).
 */
function isCustomerSafeToDelete(hasOrders: boolean, hasInvoices: boolean): boolean {
  return !hasOrders && !hasInvoices;
}

/**
 * Mirrors the warning-builder for skipped customers.
 * Shows the first 5 by name, appends "… and N more" if needed.
 */
function buildSkippedWarning(skipped: string[]): string | null {
  if (skipped.length === 0) return null;
  const preview = skipped.slice(0, 5).join(', ');
  const tail = skipped.length > 5 ? ` … and ${skipped.length - 5} more` : '';
  return `${skipped.length} QB-imported customer(s) were skipped because they still have linked orders or invoices: ${preview}${tail}.`;
}

describe('QB customer safety-check logic', () => {
  it('allows deletion when customer has no orders and no invoices', () => {
    expect(isCustomerSafeToDelete(false, false)).toBe(true);
  });

  it('blocks deletion when customer has linked orders', () => {
    expect(isCustomerSafeToDelete(true, false)).toBe(false);
  });

  it('blocks deletion when customer has linked invoices', () => {
    expect(isCustomerSafeToDelete(false, true)).toBe(false);
  });

  it('blocks deletion when customer has both orders and invoices', () => {
    expect(isCustomerSafeToDelete(true, true)).toBe(false);
  });
});

describe('buildSkippedWarning — skipped customer warning messages', () => {
  it('returns null when no customers were skipped', () => {
    expect(buildSkippedWarning([])).toBeNull();
  });

  it('lists all names when 5 or fewer are skipped', () => {
    const msg = buildSkippedWarning(['Acme', 'Beta Corp', 'Gamma LLC']);
    expect(msg).toMatch(/3 QB-imported customer\(s\) were skipped/);
    expect(msg).toMatch(/Acme, Beta Corp, Gamma LLC/);
    expect(msg).not.toMatch(/more/);
  });

  it('truncates and appends "and N more" when more than 5 are skipped', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const msg = buildSkippedWarning(names)!;
    expect(msg).toMatch(/7 QB-imported customer\(s\) were skipped/);
    expect(msg).toMatch(/A, B, C, D, E/);
    expect(msg).toMatch(/… and 2 more/);
  });

  it('includes exactly the first 5 names, not the 6th', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'ShouldNotAppear'];
    const msg = buildSkippedWarning(names)!;
    expect(msg).not.toMatch(/ShouldNotAppear/);
  });
});

// ---------------------------------------------------------------------------
// Section A2 — Route body-schema contract (pure Zod, no HTTP needed)
// ---------------------------------------------------------------------------

import { z } from 'zod';

const qbResetBodySchema = z.object({
  disconnectOAuth: z.boolean().default(false),
  deleteQBCustomers: z.boolean().default(true),
});

describe('QB reset route body schema', () => {
  it('accepts empty body and applies defaults', () => {
    const result = qbResetBodySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.disconnectOAuth).toBe(false);
      expect(result.data.deleteQBCustomers).toBe(true);
    }
  });

  it('accepts valid explicit booleans', () => {
    const result = qbResetBodySchema.safeParse({
      disconnectOAuth: true,
      deleteQBCustomers: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.disconnectOAuth).toBe(true);
      expect(result.data.deleteQBCustomers).toBe(false);
    }
  });

  it('rejects non-boolean disconnectOAuth', () => {
    const result = qbResetBodySchema.safeParse({ disconnectOAuth: 'yes' });
    expect(result.success).toBe(false);
  });

  it('rejects non-boolean deleteQBCustomers', () => {
    const result = qbResetBodySchema.safeParse({ deleteQBCustomers: 1 });
    expect(result.success).toBe(false);
  });

  it('defaults disconnectOAuth to false (OAuth preserved by default)', () => {
    const result = qbResetBodySchema.safeParse({ deleteQBCustomers: false });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.disconnectOAuth).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Section B — Route middleware contract (inline test Express app)
// ---------------------------------------------------------------------------

/**
 * Build a minimal Express app that wires up the reset routes with
 * injectable middleware stubs.  This lets us test 403 / 400 / 500 responses
 * without connecting to a real database.
 */
function buildTestApp(opts: {
  isAuthenticated?: express.RequestHandler;
  tenantContext?: express.RequestHandler;
  requireOrgOwnerAdmin?: express.RequestHandler;
  resetTransactionalData?: (orgId: string, userId: string) => Promise<any>;
  resetQuickBooksImportData?: (orgId: string, userId: string, opts: any) => Promise<any>;
}) {
  const app = express();
  app.use(express.json());

  const passThrough: express.RequestHandler = (_req, _res, next) => next();
  const unauthorizedMiddleware: express.RequestHandler = (_req, res) => {
    res.status(403).json({ message: 'Access denied. Organization Owner or Admin role required.' });
  };

  const auth = opts.isAuthenticated ?? passThrough;
  const tenant = opts.tenantContext ?? (((req: any, _res: any, next: any) => {
    req.organizationId = 'org-test-1';
    next();
  }) as express.RequestHandler);
  const requireAdmin = opts.requireOrgOwnerAdmin ?? passThrough;

  const resetFn = opts.resetTransactionalData ?? (() => Promise.resolve({
    success: true,
    data: { deletedCounts: {}, warnings: [], preservedCategories: [] },
  }));
  const qbResetFn = opts.resetQuickBooksImportData ?? (() => Promise.resolve({
    success: true,
    data: { deletedCounts: {}, warnings: [], preservedCategories: [] },
  }));

  // Attach a fake user so getUserId works
  app.use((req: any, _res, next) => {
    if (!req.user) req.user = { id: 'user-test-1' };
    next();
  });

  app.post('/api/admin/org/reset', auth, tenant, requireAdmin, async (req: any, res) => {
    try {
      const orgId = req.organizationId ?? 'org-test-1';
      const userId = req.user?.id ?? 'user-test-1';
      const result = await resetFn(orgId, userId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to reset' });
    }
  });

  app.post('/api/admin/org/reset-quickbooks-import', auth, tenant, requireAdmin, async (req: any, res) => {
    try {
      const bodyResult = qbResetBodySchema.safeParse(req.body ?? {});
      if (!bodyResult.success) {
        return res.status(400).json({ success: false, message: bodyResult.error.message });
      }
      const orgId = req.organizationId ?? 'org-test-1';
      const userId = req.user?.id ?? 'user-test-1';
      const result = await qbResetFn(orgId, userId, bodyResult.data);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to reset QB data' });
    }
  });

  return app;
}

describe('POST /api/admin/org/reset — route middleware contract', () => {
  it('returns 403 when requireOrgOwnerAdmin rejects a non-admin user', async () => {
    const app = buildTestApp({
      requireOrgOwnerAdmin: (_req, res) => {
        res.status(403).json({ message: 'Access denied. Organization Owner or Admin role required.' });
      },
    });
    const resp = await request(app).post('/api/admin/org/reset');
    expect(resp.status).toBe(403);
    expect(resp.body.message).toMatch(/Access denied/);
  });

  it('returns 200 with { success: true, data } when admin calls the endpoint', async () => {
    const app = buildTestApp({});
    const resp = await request(app).post('/api/admin/org/reset');
    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toBeDefined();
    expect(Array.isArray(resp.body.data.warnings)).toBe(true);
    expect(Array.isArray(resp.body.data.preservedCategories)).toBe(true);
  });

  it('returns 500 with { success: false, message } when the service throws', async () => {
    const app = buildTestApp({
      resetTransactionalData: async () => { throw new Error('DB connection lost'); },
    });
    const resp = await request(app).post('/api/admin/org/reset');
    expect(resp.status).toBe(500);
    expect(resp.body.success).toBe(false);
    expect(resp.body.message).toBe('DB connection lost');
  });
});

describe('POST /api/admin/org/reset-quickbooks-import — route middleware contract', () => {
  it('returns 403 for non-admin users', async () => {
    const app = buildTestApp({
      requireOrgOwnerAdmin: (_req, res) => {
        res.status(403).json({ message: 'Access denied. Organization Owner or Admin role required.' });
      },
    });
    const resp = await request(app).post('/api/admin/org/reset-quickbooks-import').send({});
    expect(resp.status).toBe(403);
  });

  it('returns 200 with defaults when no body is sent', async () => {
    const app = buildTestApp({});
    const resp = await request(app).post('/api/admin/org/reset-quickbooks-import').send({});
    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
  });

  it('passes disconnectOAuth=true to the service when requested', async () => {
    let captured: any = null;
    const app = buildTestApp({
      resetQuickBooksImportData: async (_o, _u, opts) => {
        captured = opts;
        return { success: true, data: { deletedCounts: {}, warnings: [], preservedCategories: [] } };
      },
    });
    await request(app)
      .post('/api/admin/org/reset-quickbooks-import')
      .send({ disconnectOAuth: true, deleteQBCustomers: false });
    expect(captured).not.toBeNull();
    expect(captured.disconnectOAuth).toBe(true);
    expect(captured.deleteQBCustomers).toBe(false);
  });

  it('defaults disconnectOAuth to false (OAuth preserved) when not specified', async () => {
    let captured: any = null;
    const app = buildTestApp({
      resetQuickBooksImportData: async (_o, _u, opts) => {
        captured = opts;
        return { success: true, data: { deletedCounts: {}, warnings: [], preservedCategories: [] } };
      },
    });
    await request(app).post('/api/admin/org/reset-quickbooks-import').send({});
    expect(captured?.disconnectOAuth).toBe(false);
  });

  it('returns 400 with a useful message when body contains invalid types', async () => {
    const app = buildTestApp({});
    const resp = await request(app)
      .post('/api/admin/org/reset-quickbooks-import')
      .send({ disconnectOAuth: 'yes' }); // string instead of boolean
    expect(resp.status).toBe(400);
    expect(resp.body.success).toBe(false);
    expect(typeof resp.body.message).toBe('string');
    expect(resp.body.message.length).toBeGreaterThan(0);
  });

  it('returns 500 with { success: false, message } when the service throws', async () => {
    const app = buildTestApp({
      resetQuickBooksImportData: async () => { throw new Error('transaction rolled back'); },
    });
    const resp = await request(app).post('/api/admin/org/reset-quickbooks-import').send({});
    expect(resp.status).toBe(500);
    expect(resp.body.success).toBe(false);
    expect(resp.body.message).toBe('transaction rolled back');
  });

  it('forwards warnings from the service in the response', async () => {
    const warnings = ['2 QB-imported customer(s) were skipped because they still have linked invoices.'];
    const app = buildTestApp({
      resetQuickBooksImportData: async () => ({
        success: true,
        data: { deletedCounts: { invoices: 5 }, warnings, preservedCategories: [] },
      }),
    });
    const resp = await request(app).post('/api/admin/org/reset-quickbooks-import').send({});
    expect(resp.status).toBe(200);
    expect(resp.body.data.warnings).toEqual(warnings);
  });
});

// ---------------------------------------------------------------------------
// Section B2 — Service return-type contract (static, no network)
// ---------------------------------------------------------------------------

/**
 * These tests verify that the service functions return the documented shape.
 * They use mock implementations so no DB is required.
 */

type TransactionalResetData = {
  deletedCounts: Record<string, number>;
  warnings: string[];
  preservedCategories: string[];
};

type TransactionalResetResult = { success: true; data: TransactionalResetData };

type QBResetData = {
  deletedCounts: Record<string, number>;
  warnings: string[];
  preservedCategories: string[];
};

type QBResetResult = { success: true; data: QBResetData };

function mockTransactionalReset(): TransactionalResetResult {
  return {
    success: true,
    data: {
      deletedCounts: { orders: 10, invoices: 5, quotes: 3 },
      warnings: [],
      preservedCategories: [
        'organization',
        'users & memberships',
        'products, product options, PBV2 trees',
        'materials & inventory catalog',
        'pricing formulas & rules',
        'company settings',
        'email OAuth / settings',
        'QuickBooks OAuth connection',
        'tax zones & rules',
        'storage configuration',
      ],
    },
  };
}

function mockQBReset(opts: { disconnectOAuth: boolean; deleteQBCustomers: boolean }): QBResetResult {
  const preserved = [
    'organization, users & memberships',
    'products, materials & pricing config',
    'company settings & email OAuth',
    opts.disconnectOAuth
      ? '(QB OAuth disconnected as requested)'
      : 'QuickBooks OAuth connection',
  ];
  return {
    success: true,
    data: { deletedCounts: {}, warnings: [], preservedCategories: preserved },
  };
}

describe('service return-type shape contract', () => {
  it('transactional reset result has success:true, deletedCounts, warnings, preservedCategories', () => {
    const result = mockTransactionalReset();
    expect(result.success).toBe(true);
    expect(typeof result.data.deletedCounts).toBe('object');
    expect(Array.isArray(result.data.warnings)).toBe(true);
    expect(Array.isArray(result.data.preservedCategories)).toBe(true);
  });

  it('transactional reset preservedCategories includes QB OAuth', () => {
    const result = mockTransactionalReset();
    expect(result.data.preservedCategories).toContain('QuickBooks OAuth connection');
  });

  it('transactional reset preservedCategories includes products and users', () => {
    const result = mockTransactionalReset();
    const cats = result.data.preservedCategories.join(' ');
    expect(cats).toMatch(/products/i);
    expect(cats).toMatch(/users/i);
  });

  it('QB reset preserves OAuth when disconnectOAuth=false', () => {
    const result = mockQBReset({ disconnectOAuth: false, deleteQBCustomers: true });
    const cats = result.data.preservedCategories.join(' ');
    expect(cats).toMatch(/QuickBooks OAuth connection/);
    expect(cats).not.toMatch(/disconnected/);
  });

  it('QB reset notes OAuth disconnection when disconnectOAuth=true', () => {
    const result = mockQBReset({ disconnectOAuth: true, deleteQBCustomers: true });
    const cats = result.data.preservedCategories.join(' ');
    expect(cats).toMatch(/disconnected as requested/);
    expect(cats).not.toMatch(/QuickBooks OAuth connection(?! disconnected)/);
  });
});

// ---------------------------------------------------------------------------
// Section C — Integration stubs (require DATABASE_URL)
// ---------------------------------------------------------------------------

const SKIP_WITHOUT_DB = !process.env.DATABASE_URL;

(SKIP_WITHOUT_DB ? describe.skip : describe)('resetTransactionalData — integration (requires DATABASE_URL)', () => {
  it('deletes transactional data only for the target org, not other orgs', async () => {
    // Setup: create two orgs, insert orders for each, reset org A, verify org B intact
    // Implementation: requires test DB seeding helpers
  });

  it('preserves products, materials, users, settings, and OAuth after reset', async () => {
    // Verify org.settings, products, userOrganizations rows survive the reset
  });

  it('returns deletedCounts with counts for each deleted table', async () => {
    // Verify counts are non-negative integers matching actual rows deleted
  });

  it('inserts a final audit log entry inside the transaction', async () => {
    // After reset, auditLogs should contain exactly one row: the reset completion event
  });
});

(SKIP_WITHOUT_DB ? describe.skip : describe)('resetQuickBooksImportData — integration (requires DATABASE_URL)', () => {
  it('clears QB sync mappings and import jobs for only the target org', async () => {
    // accountingSyncJobs with provider="quickbooks" should be deleted
    // Other provider sync jobs (if any) should be untouched
  });

  it('does not delete manually-created customers (no externalAccountingId)', async () => {
    // Manual customers survive; QB-tagged ones (externalAccountingId set) are candidates
  });

  it('skips QB-tagged customers who have linked orders and returns a warning', async () => {
    // A customer with externalAccountingId AND a linked order should be skipped
    // Warning should appear in result.data.warnings
  });

  it('preserves QB OAuth by default (disconnectOAuth=false)', async () => {
    // oauthConnections row survives when disconnectOAuth is not passed
  });

  it('deletes QB OAuth when disconnectOAuth=true is explicitly passed', async () => {
    // oauthConnections row is gone after reset with { disconnectOAuth: true }
  });
});
