/**
 * Multi-Tenant Architecture Smoke Tests
 * 
 * These tests verify that the multi-tenant isolation works correctly.
 * They test organization isolation, portal isolation, and QuickBooks tenant scoping.
 * 
 * PREREQUISITES:
 * 1. Run migrations 0020_multi_tenant_organizations.sql and 0021_add_organization_id_to_tables.sql
 * 2. Ensure DATABASE_URL is set in .env
 * 
 * Run with: npm test
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import express, { Express, Response, NextFunction } from 'express';
import session from 'express-session';
import request from 'supertest';
import { db } from '../db';
import { storage } from '../storage';
import { 
  users, 
  organizations, 
  userOrganizations, 
  customers, 
  products,
  productVariants,
  quotes, 
  orders
} from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import { tenantContext, portalContext, getRequestOrganizationId } from '../tenantContext';

// ============================================================================
// Schema Readiness Check
// ============================================================================

let schemaReady = false;
let schemaError = '';

async function checkSchemaReady(): Promise<boolean> {
  try {
    // Check if organization_id column exists in customers table
    const result = await db.execute(sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'customers' 
      AND column_name = 'organization_id'
    `);
    
    if (result.rows.length === 0) {
      schemaError = 'Multi-tenant schema not applied. Run migrations 0020 and 0021 first.';
      return false;
    }
    
    // Check if organizations table exists
    const orgsCheck = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name = 'organizations'
    `);
    
    if (orgsCheck.rows.length === 0) {
      schemaError = 'Organizations table not found. Run migration 0020 first.';
      return false;
    }
    
    return true;
  } catch (error: any) {
    schemaError = `Schema check failed: ${error.message}`;
    return false;
  }
}

// ============================================================================
// Test App Factory - Creates a minimal Express app for testing
// ============================================================================

function createTestApp(): Express {
  const app = express();
  
  app.use(express.json());
  app.use(session({
    secret: 'test-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  }));
  
  // Mock user injection middleware - sets req.user from header
  app.use((req: any, res: Response, next: NextFunction) => {
    const userId = req.headers['x-test-user-id'];
    const userRole = req.headers['x-test-user-role'] || 'employee';
    const orgId = req.headers['x-test-org-id'];

    // Map test org header to the header that tenantContext actually reads
    if (orgId) {
      req.headers['x-organization-id'] = orgId;
    }
    
    if (userId) {
      req.user = {
        id: userId,
        role: userRole,
        organizationId: orgId
      };
      req.isAuthenticated = () => true;
    } else {
      req.isAuthenticated = () => false;
    }
    next();
  });
  
  // Mock isAuthenticated middleware
  const isAuthenticated = (req: any, res: Response, next: NextFunction) => {
    if (req.isAuthenticated && req.isAuthenticated()) {
      return next();
    }
    return res.status(401).json({ message: 'Unauthorized' });
  };
  
  // -------------------------------------------------------------------------
  // TENANT-SCOPED ROUTES (Organization Isolation Test)
  // -------------------------------------------------------------------------
  
  // GET /api/orders - List orders for current tenant
  app.get('/api/orders', isAuthenticated, tenantContext, async (req: any, res: Response) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const orderList = await storage.getAllOrders(organizationId, {});
      res.json(orderList);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // POST /api/orders - Create order for current tenant
  app.post('/api/orders', isAuthenticated, tenantContext, async (req: any, res: Response) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const orderData = {
        ...req.body,
        createdByUserId: req.user.id,
        lineItems: req.body.lineItems || []
      };
      const order = await storage.createOrder(organizationId, orderData);
      res.status(201).json(order);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // GET /api/customers - List customers for current tenant
  app.get('/api/customers', isAuthenticated, tenantContext, async (req: any, res: Response) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const customerList = await storage.getAllCustomers(organizationId);
      res.json(customerList);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // POST /api/customers - Create customer for current tenant
  app.post('/api/customers', isAuthenticated, tenantContext, async (req: any, res: Response) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const customer = await storage.createCustomer(organizationId, req.body);
      res.status(201).json(customer);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // GET /api/quotes - List quotes for current tenant
  app.get('/api/quotes', isAuthenticated, tenantContext, async (req: any, res: Response) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const quoteList = await storage.getAllQuotes(organizationId);
      res.json(quoteList);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // POST /api/quotes - Create quote for current tenant
  app.post('/api/quotes', isAuthenticated, tenantContext, async (req: any, res: Response) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const quoteData = {
        ...req.body,
        userId: req.user.id,
        lineItems: req.body.lineItems || []
      };
      const quote = await storage.createQuote(organizationId, quoteData);
      res.status(201).json(quote);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // -------------------------------------------------------------------------
  // PORTAL ROUTES (Customer Portal Isolation Test)
  // -------------------------------------------------------------------------
  
  // Mock portal authentication - uses customer token
  const mockPortalAuth = async (req: any, res: Response, next: NextFunction) => {
    const customerId = req.headers['x-portal-customer-id'];
    if (!customerId) {
      return res.status(401).json({ message: 'Portal authentication required' });
    }

    // portalContext requires req.user.id, and will resolve the customer by userId or email.
    // In tests we only have a customerId header, so look up the customer and provide a user with that email.
    const customerRows = await db
      .select({ email: customers.email })
      .from(customers)
      .where(eq(customers.id, customerId as string))
      .limit(1);

    if (customerRows.length === 0) {
      return res.status(401).json({ message: 'Portal authentication required' });
    }

    req.portalCustomerId = customerId as string;
    req.user = { id: `portal:${customerId}`, email: customerRows[0].email };
    req.isAuthenticated = () => true;
    return next();
  };
  
  // GET /api/portal/my-quotes - Portal user's quotes
  app.get('/api/portal/my-quotes', mockPortalAuth, portalContext, async (req: any, res: Response) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const customerId = req.portalCustomerId;
      
      // Get quotes for this customer only
      const allQuotes = await storage.getAllQuotes(organizationId);
      const customerQuotes = allQuotes.filter((q: any) => q.customerId === customerId);
      
      res.json(customerQuotes);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // GET /api/portal/my-orders - Portal user's orders
  app.get('/api/portal/my-orders', mockPortalAuth, portalContext, async (req: any, res: Response) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const customerId = req.portalCustomerId;
      
      // Get orders for this customer only
      const allOrders = await storage.getAllOrders(organizationId, {});
      const customerOrders = allOrders.filter((o: any) => o.customerId === customerId);
      
      res.json(customerOrders);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // -------------------------------------------------------------------------
  // QUICKBOOKS ROUTES (Tenant Scoping Test)
  // -------------------------------------------------------------------------
  
  // GET /api/integrations/quickbooks/status - QB connection status
  app.get('/api/integrations/quickbooks/status', isAuthenticated, tenantContext, async (req: any, res: Response) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      
      // Mock QB status response with tenant info
      res.json({
        connected: false,
        organizationId,
        realmId: null,
        lastSyncAt: null,
        companyName: null
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  return app;
}

// ============================================================================
// Test Fixtures & Helpers
// ============================================================================

interface TestOrg {
  id: string;
  name: string;
  slug: string;
}

interface TestUser {
  id: string;
  email: string;
  orgId: string;
}

interface TestCustomer {
  id: string;
  companyName: string;
  orgId: string;
}

interface TestQuote {
  id: string;
  customerId: string;
  orgId: string;
}

interface TestOrder {
  id: string;
  customerId: string;
  orgId: string;
}

// Test data holders
let org1: TestOrg;
let org2: TestOrg;
let userOrg1: TestUser;
let userOrg2: TestUser;
let customerOrg1: TestCustomer;
let customerOrg2: TestCustomer;
let quoteOrg1: TestQuote;
let quoteOrg2: TestQuote;
let orderOrg1: TestOrder;
let orderOrg2: TestOrder;

let orderProductOrg1: { productId: string; variantId: string };
let orderProductOrg2: { productId: string; variantId: string };

let testApp: Express;

// ============================================================================
// Test Setup & Teardown
// ============================================================================

beforeAll(async () => {
  // First, check if the schema is ready
  schemaReady = await checkSchemaReady();
  
  if (!schemaReady) {
    console.error('\n');
    console.error('='.repeat(70));
    console.error('MULTI-TENANT SCHEMA NOT READY');
    console.error('='.repeat(70));
    console.error(schemaError);
    console.error('\nTo fix this, run the following migrations against your database:');
    console.error('  1. migrations/0020_multi_tenant_organizations.sql');
    console.error('  2. migrations/0021_add_organization_id_to_tables.sql');
    console.error('\nOr use: npm run db:push');
    console.error('='.repeat(70));
    console.error('\n');
    return;
  }
  
  testApp = createTestApp();
  
  const timestamp = Date.now();
  
  // Create test organizations
  const [createdOrg1] = await db.insert(organizations).values({
    name: 'Test Org Alpha',
    slug: `test-org-alpha-${timestamp}`
  }).returning();
  
  const [createdOrg2] = await db.insert(organizations).values({
    name: 'Test Org Beta',
    slug: `test-org-beta-${timestamp}`
  }).returning();
  
  org1 = { id: createdOrg1.id, name: createdOrg1.name, slug: createdOrg1.slug };
  org2 = { id: createdOrg2.id, name: createdOrg2.name, slug: createdOrg2.slug };
  
  // Create test users
  const [createdUser1] = await db.insert(users).values({
    email: `testuser1-${timestamp}@test.com`,
    firstName: 'Test',
    lastName: 'User1',
    role: 'admin'
  }).returning();
  
  const [createdUser2] = await db.insert(users).values({
    email: `testuser2-${timestamp}@test.com`,
    firstName: 'Test',
    lastName: 'User2',
    role: 'admin'
  }).returning();
  
  userOrg1 = { id: createdUser1.id, email: createdUser1.email!, orgId: org1.id };
  userOrg2 = { id: createdUser2.id, email: createdUser2.email!, orgId: org2.id };
  
  // Link users to organizations
  await db.insert(userOrganizations).values({
    userId: userOrg1.id,
    organizationId: org1.id,
    role: 'admin',
    isDefault: true
  });
  
  await db.insert(userOrganizations).values({
    userId: userOrg2.id,
    organizationId: org2.id,
    role: 'admin',
    isDefault: true
  });
  
  // Create test customers
  const customer1 = await storage.createCustomer(org1.id, {
  companyName: "Customer Alpha",
  email: "alpha@example.com",
  status: "active",

  pricingTier: "default",
  productVisibilityMode: "default",
  isTaxExempt: false,
  taxRateOverride: null,
});
  
  const customer2 = await storage.createCustomer(org2.id, {
  companyName: "Customer Beta",
  email: "beta@example.com",
  status: "active",

  pricingTier: "default",
  productVisibilityMode: "default",
  isTaxExempt: false,
  taxRateOverride: null,
});
  
  customerOrg1 = { id: customer1.id, companyName: customer1.companyName, orgId: org1.id };
  customerOrg2 = { id: customer2.id, companyName: customer2.companyName, orgId: org2.id };

  // Create a minimal product + variant per org so orders can include valid line items
  const [product1] = await db.insert(products).values({
    organizationId: org1.id,
    name: `Test Product Org1 ${timestamp}`,
    description: 'Test product for multi-tenant smoke tests',
  }).returning();
  const [variant1] = await db.insert(productVariants).values({
    productId: product1.id,
    name: 'Default',
    basePricePerSqft: '1.0000',
    isDefault: true,
    displayOrder: 0,
    isActive: true,
  }).returning();
  orderProductOrg1 = { productId: product1.id, variantId: variant1.id };

  const [product2] = await db.insert(products).values({
    organizationId: org2.id,
    name: `Test Product Org2 ${timestamp}`,
    description: 'Test product for multi-tenant smoke tests',
  }).returning();
  const [variant2] = await db.insert(productVariants).values({
    productId: product2.id,
    name: 'Default',
    basePricePerSqft: '1.0000',
    isDefault: true,
    displayOrder: 0,
    isActive: true,
  }).returning();
  orderProductOrg2 = { productId: product2.id, variantId: variant2.id };
  
  // Create test quotes
  const quote1 = await storage.createQuote(org1.id, {
    userId: userOrg1.id,
    customerId: customerOrg1.id,
    customerName: 'Customer Alpha',
    lineItems: []
  });
  
  const quote2 = await storage.createQuote(org2.id, {
    userId: userOrg2.id,
    customerId: customerOrg2.id,
    customerName: 'Customer Beta',
    lineItems: []
  });
  
  quoteOrg1 = { id: quote1.id, customerId: quote1.customerId!, orgId: org1.id };
  quoteOrg2 = { id: quote2.id, customerId: quote2.customerId!, orgId: org2.id };
  
  // Create test orders
  const order1 = await storage.createOrder(org1.id, {
    customerId: customerOrg1.id,
    status: 'pending',
    createdByUserId: userOrg1.id,
    lineItems: [
      {
        status: "queued",
        productType: "print",
        productId: orderProductOrg1.productId,
        productVariantId: orderProductOrg1.variantId,
        description: 'Test Item',
        quantity: 1,
        unitPrice: 1,
        totalPrice: 1,
        taxAmount: "0",
        isTaxableSnapshot: true,
      },
    ]
  });
  
  const order2 = await storage.createOrder(org2.id, {
    customerId: customerOrg2.id,
    status: 'pending',
    createdByUserId: userOrg2.id,
    lineItems: [
      {
        status: "queued",
        productType: "print",
        productId: orderProductOrg2.productId,
        productVariantId: orderProductOrg2.variantId,
        description: 'Test Item',
        quantity: 1,
        unitPrice: 1,
        totalPrice: 1,
        taxAmount: "0",
        isTaxableSnapshot: true,
      },
    ]
  });
  
  orderOrg1 = { id: order1.id, customerId: order1.customerId!, orgId: org1.id };
  orderOrg2 = { id: order2.id, customerId: order2.customerId!, orgId: org2.id };
});

afterAll(async () => {
  // Clean up test data in reverse order of dependencies
  try {
    // Delete orders
    if (orderOrg1) await db.delete(orders).where(eq(orders.id, orderOrg1.id));
    if (orderOrg2) await db.delete(orders).where(eq(orders.id, orderOrg2.id));
    
    // Delete quotes
    if (quoteOrg1) await db.delete(quotes).where(eq(quotes.id, quoteOrg1.id));
    if (quoteOrg2) await db.delete(quotes).where(eq(quotes.id, quoteOrg2.id));
    
    // Delete customers
    if (customerOrg1) await db.delete(customers).where(eq(customers.id, customerOrg1.id));
    if (customerOrg2) await db.delete(customers).where(eq(customers.id, customerOrg2.id));
    
    // Delete user-org links
    if (userOrg1) await db.delete(userOrganizations).where(eq(userOrganizations.userId, userOrg1.id));
    if (userOrg2) await db.delete(userOrganizations).where(eq(userOrganizations.userId, userOrg2.id));
    
    // Delete users
    if (userOrg1) await db.delete(users).where(eq(users.id, userOrg1.id));
    if (userOrg2) await db.delete(users).where(eq(users.id, userOrg2.id));
    
    // Delete organizations
    if (org1) await db.delete(organizations).where(eq(organizations.id, org1.id));
    if (org2) await db.delete(organizations).where(eq(organizations.id, org2.id));
  } catch (error) {
    console.error('Cleanup error:', error);
  }
});

// ============================================================================
// Skip helper - skips test if schema not ready
// ============================================================================

function skipIfSchemaNotReady() {
  if (!schemaReady) {
    test.skip('SKIPPED - Schema not ready', () => {});
    return true;
  }
  return false;
}

// ============================================================================
// TEST 1: Core Organization Isolation (Orders)
// ============================================================================

describe('TEST 1: Core Organization Isolation', () => {
  
  beforeAll(() => {
    if (!schemaReady) {
      console.log('Skipping TEST 1 - Multi-tenant schema not applied');
    }
  });
  
  test('User in Org1 can only see Org1 orders', async () => {
    if (!schemaReady) return;
    
    const response = await request(testApp)
      .get('/api/orders')
      .set('x-test-user-id', userOrg1.id)
      .set('x-test-org-id', org1.id)
      .expect(200);
    
    const orderList = response.body;
    expect(Array.isArray(orderList)).toBe(true);
    
    // All returned orders should belong to org1
    for (const order of orderList) {
      expect(order.organizationId).toBe(org1.id);
    }
    
    // Should contain our test order
    const testOrder = orderList.find((o: any) => o.id === orderOrg1.id);
    expect(testOrder).toBeDefined();
    
    // Should NOT contain org2's order
    const wrongOrder = orderList.find((o: any) => o.id === orderOrg2.id);
    expect(wrongOrder).toBeUndefined();
  });
  
  test('User in Org2 can only see Org2 orders', async () => {
    if (!schemaReady) return;
    
    const response = await request(testApp)
      .get('/api/orders')
      .set('x-test-user-id', userOrg2.id)
      .set('x-test-org-id', org2.id)
      .expect(200);
    
    const orderList = response.body;
    expect(Array.isArray(orderList)).toBe(true);
    
    // All returned orders should belong to org2
    for (const order of orderList) {
      expect(order.organizationId).toBe(org2.id);
    }
    
    // Should contain our test order
    const testOrder = orderList.find((o: any) => o.id === orderOrg2.id);
    expect(testOrder).toBeDefined();
    
    // Should NOT contain org1's order
    const wrongOrder = orderList.find((o: any) => o.id === orderOrg1.id);
    expect(wrongOrder).toBeUndefined();
  });
  
  test('Creating order in Org1 sets correct organizationId', async () => {
    if (!schemaReady) return;
    
    const timestamp = Date.now();
    const response = await request(testApp)
      .post('/api/orders')
      .set('x-test-user-id', userOrg1.id)
      .set('x-test-org-id', org1.id)
      .send({
        customerId: customerOrg1.id,
        status: 'pending',
        lineItems: [
          {
            productId: orderProductOrg1.productId,
            productVariantId: orderProductOrg1.variantId,
            description: 'Test Item',
            quantity: 1,
            unitPrice: 1,
            totalPrice: 1,
            taxAmount: "0",
            isTaxableSnapshot: true,
          },
        ]
      })
      .expect(201);
    
    const newOrder = response.body;
    expect(newOrder.organizationId).toBe(org1.id);
    
    // Cleanup
    await db.delete(orders).where(eq(orders.id, newOrder.id));
  });
  
  test('Customers are isolated by organization', async () => {
    if (!schemaReady) return;
    
    // Org1 user sees Org1 customers
    const response1 = await request(testApp)
      .get('/api/customers')
      .set('x-test-user-id', userOrg1.id)
      .set('x-test-org-id', org1.id)
      .expect(200);
    
    const customers1 = response1.body;
    for (const customer of customers1) {
      expect(customer.organizationId).toBe(org1.id);
    }
    
    // Org2 user sees Org2 customers
    const response2 = await request(testApp)
      .get('/api/customers')
      .set('x-test-user-id', userOrg2.id)
      .set('x-test-org-id', org2.id)
      .expect(200);
    
    const customers2 = response2.body;
    for (const customer of customers2) {
      expect(customer.organizationId).toBe(org2.id);
    }
  });
  
  test('Quotes are isolated by organization', async () => {
    if (!schemaReady) return;
    
    // Org1 user sees Org1 quotes
    const response1 = await request(testApp)
      .get('/api/quotes')
      .set('x-test-user-id', userOrg1.id)
      .set('x-test-org-id', org1.id)
      .expect(200);
    
    const quotes1 = response1.body;
    for (const quote of quotes1) {
      expect(quote.organizationId).toBe(org1.id);
    }
    
    // Org2 user sees Org2 quotes
    const response2 = await request(testApp)
      .get('/api/quotes')
      .set('x-test-user-id', userOrg2.id)
      .set('x-test-org-id', org2.id)
      .expect(200);
    
    const quotes2 = response2.body;
    for (const quote of quotes2) {
      expect(quote.organizationId).toBe(org2.id);
    }
  });
});

// ============================================================================
// TEST 2: Portal Isolation
// ============================================================================

describe('TEST 2: Portal Isolation', () => {
  
  beforeAll(() => {
    if (!schemaReady) {
      console.log('Skipping TEST 2 - Multi-tenant schema not applied');
    }
  });
  
  test('Portal customer in Org1 only sees their quotes', async () => {
    if (!schemaReady) return;
    
    const response = await request(testApp)
      .get('/api/portal/my-quotes')
      .set('x-portal-customer-id', customerOrg1.id)
      .expect(200);
    
    const quoteList = response.body;
    expect(Array.isArray(quoteList)).toBe(true);
    
    // All returned quotes should belong to this customer
    for (const quote of quoteList) {
      expect(quote.customerId).toBe(customerOrg1.id);
    }
  });
  
  test('Portal customer in Org2 only sees their orders', async () => {
    if (!schemaReady) return;
    
    const response = await request(testApp)
      .get('/api/portal/my-orders')
      .set('x-portal-customer-id', customerOrg2.id)
      .expect(200);
    
    const orderList = response.body;
    expect(Array.isArray(orderList)).toBe(true);
    
    // All returned orders should belong to this customer
    for (const order of orderList) {
      expect(order.customerId).toBe(customerOrg2.id);
    }
  });
  
  test('Portal customer cannot see other customers data', async () => {
    if (!schemaReady) return;
    
    // Customer 1 requests orders
    const response = await request(testApp)
      .get('/api/portal/my-orders')
      .set('x-portal-customer-id', customerOrg1.id)
      .expect(200);
    
    const orderList = response.body;
    
    // Should NOT contain customer 2's order
    const wrongOrder = orderList.find((o: any) => o.customerId === customerOrg2.id);
    expect(wrongOrder).toBeUndefined();
  });
  
  test('Portal requires authentication', async () => {
    if (!schemaReady) return;
    
    // No customer ID header
    await request(testApp)
      .get('/api/portal/my-quotes')
      .expect(401);
  });
});

// ============================================================================
// TEST 3: QuickBooks Tenant Scoping
// ============================================================================

describe('TEST 3: QuickBooks Tenant Scoping', () => {
  
  beforeAll(() => {
    if (!schemaReady) {
      console.log('Skipping TEST 3 - Multi-tenant schema not applied');
    }
  });
  
  test('QB status endpoint requires authentication', async () => {
    if (!schemaReady) return;
    
    await request(testApp)
      .get('/api/integrations/quickbooks/status')
      .expect(401);
  });
  
  test('QB status endpoint returns tenant-scoped response for Org1', async () => {
    if (!schemaReady) return;
    
    const response = await request(testApp)
      .get('/api/integrations/quickbooks/status')
      .set('x-test-user-id', userOrg1.id)
      .set('x-test-org-id', org1.id)
      .expect(200);
    
    const status = response.body;
    
    // Should have proper structure
    expect(status).toHaveProperty('connected');
    expect(status).toHaveProperty('organizationId');
    expect(status).toHaveProperty('realmId');
    expect(status).toHaveProperty('lastSyncAt');
    
    // Should be scoped to org1
    expect(status.organizationId).toBe(org1.id);
  });
  
  test('QB status endpoint returns tenant-scoped response for Org2', async () => {
    if (!schemaReady) return;
    
    const response = await request(testApp)
      .get('/api/integrations/quickbooks/status')
      .set('x-test-user-id', userOrg2.id)
      .set('x-test-org-id', org2.id)
      .expect(200);
    
    const status = response.body;
    
    // Should be scoped to org2
    expect(status.organizationId).toBe(org2.id);
  });
});

// ============================================================================
// TEST 4: Cross-Tenant Security
// ============================================================================

describe('TEST 4: Cross-Tenant Security', () => {
  
  beforeAll(() => {
    if (!schemaReady) {
      console.log('Skipping TEST 4 - Multi-tenant schema not applied');
    }
  });
  
  test('Accessing with different org context returns different data', async () => {
    if (!schemaReady) return;
    
    // User from Org1 with Org2's context
    // In the real app, this would be blocked by middleware that validates org membership
    // Here we assert the request is forbidden to prevent cross-tenant access
    const response = await request(testApp)
      .get('/api/orders')
      .set('x-test-user-id', userOrg1.id)
      .set('x-test-org-id', org2.id)
      .expect(403);

    expect(response.body).toHaveProperty('message');
  });
  
  test('Unauthenticated requests are rejected', async () => {
    if (!schemaReady) return;
    
    await request(testApp)
      .get('/api/orders')
      .expect(401);
    
    await request(testApp)
      .get('/api/customers')
      .expect(401);
    
    await request(testApp)
      .get('/api/quotes')
      .expect(401);
  });
});

// ============================================================================
// TEST 5: Data Creation Isolation
// ============================================================================

describe('TEST 5: Data Creation Isolation', () => {
  
  beforeAll(() => {
    if (!schemaReady) {
      console.log('Skipping TEST 5 - Multi-tenant schema not applied');
    }
  });
  
  test('New customer is created with correct organizationId', async () => {
    if (!schemaReady) return;
    
    const timestamp = Date.now();
    const response = await request(testApp)
      .post('/api/customers')
      .set('x-test-user-id', userOrg1.id)
      .set('x-test-org-id', org1.id)
      .send({
        companyName: `New Test Customer ${timestamp}`,
        email: `newcustomer-${timestamp}@test.com`,
        status: 'active'
      })
      .expect(201);
    
    const newCustomer = response.body;
    expect(newCustomer.organizationId).toBe(org1.id);
    
    // Cleanup
    await db.delete(customers).where(eq(customers.id, newCustomer.id));
  });
  
  test('New quote is created with correct organizationId', async () => {
    if (!schemaReady) return;
    
    const timestamp = Date.now();
    const response = await request(testApp)
      .post('/api/quotes')
      .set('x-test-user-id', userOrg1.id)
      .set('x-test-org-id', org1.id)
      .send({
        customerId: customerOrg1.id,
        customerName: 'Test Customer for Quote',
        lineItems: []
      })
      .expect(201);
    
    const newQuote = response.body;
    expect(newQuote.organizationId).toBe(org1.id);
    
    // Cleanup
    await db.delete(quotes).where(eq(quotes.id, newQuote.id));
  });
});
