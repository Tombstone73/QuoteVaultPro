import OAuthClient from 'intuit-oauth';
import { db } from './db';
import { oauthConnections, accountingSyncJobs, customers, invoices, orders } from '../shared/schema';
import { eq, and, desc, or, isNull, sql } from 'drizzle-orm';
import type { Customer } from '../shared/schema';

// Initialize QuickBooks OAuth client
const getOAuthClient = (): OAuthClient | null => {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI;
  const environment = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';

  if (!clientId || !clientSecret || !redirectUri) {
    console.warn('[QuickBooks] OAuth credentials not configured');
    return null;
  }

  return new OAuthClient({
    clientId,
    clientSecret,
    environment: environment as 'sandbox' | 'production',
    redirectUri,
  });
};

/**
 * Get the active QuickBooks OAuth connection for the company
 */
export async function getActiveConnection() {
  const [connection] = await db
    .select()
    .from(oauthConnections)
    .where(eq(oauthConnections.provider, 'quickbooks'))
    .orderBy(desc(oauthConnections.createdAt))
    .limit(1);

  return connection || null;
}

/**
 * Generate OAuth authorization URL to redirect user to QuickBooks login
 */
export async function getAuthorizationUrl(): Promise<string> {
  const oauthClient = getOAuthClient();
  if (!oauthClient) {
    throw new Error('QuickBooks OAuth not configured');
  }

  const authUrl = oauthClient.authorizeUri({
    scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
    state: 'qvp-' + Date.now(), // CSRF protection
  });

  return authUrl;
}

/**
 * Exchange authorization code for access/refresh tokens
 */
export async function exchangeCodeForTokens(
  authorizationCode: string,
  realmId: string
): Promise<void> {
  const oauthClient = getOAuthClient();
  if (!oauthClient) {
    throw new Error('QuickBooks OAuth not configured');
  }

  // Exchange code for tokens
  const authResponse = await oauthClient.createToken(authorizationCode);
  const token = authResponse.token;

  // Delete existing connection (only one active QB connection allowed)
  await db
    .delete(oauthConnections)
    .where(eq(oauthConnections.provider, 'quickbooks'));

  // Store new connection
  await db.insert(oauthConnections).values({
    provider: 'quickbooks',
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: new Date(Date.now() + (token.expires_in || 3600) * 1000),
    companyId: realmId,
    metadata: {
      realmId,
      tokenType: token.token_type,
      createdAt: new Date().toISOString(),
    },
  });
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(): Promise<boolean> {
  const connection = await getActiveConnection();
  if (!connection || !connection.refreshToken) {
    return false;
  }

  const oauthClient = getOAuthClient();
  if (!oauthClient) {
    throw new Error('QuickBooks OAuth not configured');
  }

  try {
    // Set the refresh token
    oauthClient.setToken({
      refresh_token: connection.refreshToken,
    } as any);

    // Refresh the token
    const authResponse = await oauthClient.refresh();
    const token = authResponse.token;

    // Update stored connection
    await db
      .update(oauthConnections)
      .set({
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: new Date(Date.now() + (token.expires_in || 3600) * 1000),
        updatedAt: new Date(),
      })
      .where(eq(oauthConnections.id, connection.id));

    return true;
  } catch (error) {
    console.error('[QuickBooks] Token refresh failed:', error);
    return false;
  }
}

/**
 * Get valid access token (refresh if needed)
 */
export async function getValidAccessToken(): Promise<string | null> {
  const connection = await getActiveConnection();
  if (!connection) {
    return null;
  }

  // Check if token is expired or about to expire (within 5 minutes)
  const now = new Date();
  const expiresAt = new Date(connection.expiresAt);
  const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

  if (expiresAt <= fiveMinutesFromNow) {
    console.log('[QuickBooks] Token expired or expiring soon, refreshing...');
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      return null;
    }
    // Re-fetch connection after refresh
    const updatedConnection = await getActiveConnection();
    return updatedConnection?.accessToken || null;
  }

  return connection.accessToken;
}

/**
 * Disconnect QuickBooks integration
 */
export async function disconnectConnection(): Promise<void> {
  const connection = await getActiveConnection();
  if (!connection) {
    return;
  }

  const oauthClient = getOAuthClient();
  if (oauthClient && connection.accessToken) {
    try {
      // Revoke tokens with QuickBooks
      oauthClient.setToken({
        access_token: connection.accessToken,
        refresh_token: connection.refreshToken,
      } as any);
      await oauthClient.revoke();
    } catch (error) {
      console.error('[QuickBooks] Token revocation failed:', error);
    }
  }

  // Delete from database
  await db
    .delete(oauthConnections)
    .where(eq(oauthConnections.id, connection.id));
}

/**
 * Queue sync jobs for push or pull operations
 */
export async function queueSyncJobs(
  direction: 'push' | 'pull',
  resources: Array<'customers' | 'invoices' | 'orders'>
): Promise<void> {
  const connection = await getActiveConnection();
  if (!connection) {
    throw new Error('QuickBooks not connected');
  }

  const jobs = resources.map((resource) => ({
    provider: 'quickbooks' as const,
    direction: direction as 'push' | 'pull',
    resourceType: resource as 'customers' | 'invoices' | 'orders',
    status: 'pending' as const,
  }));

  await db.insert(accountingSyncJobs).values(jobs);
}

// ==================== Data Mapping Functions ====================

/**
 * Map QuickBooks Customer to local Customer format
 */
function mapQBCustomerToLocal(qbCustomer: any): Partial<Customer> {
  return {
    companyName: qbCustomer.DisplayName || qbCustomer.CompanyName || 'Unknown',
    email: qbCustomer.PrimaryEmailAddr?.Address || null,
    phone: qbCustomer.PrimaryPhone?.FreeFormNumber || null,
    website: qbCustomer.WebAddr?.URI || null,
    billingAddress: qbCustomer.BillAddr ? formatQBAddress(qbCustomer.BillAddr) : null,
    shippingAddress: qbCustomer.ShipAddr ? formatQBAddress(qbCustomer.ShipAddr) : null,
    currentBalance: qbCustomer.Balance?.toString() || '0',
    externalAccountingId: qbCustomer.Id,
    syncStatus: 'synced',
    syncedAt: new Date(),
    notes: qbCustomer.Notes || null,
  };
}

/**
 * Map local Customer to QuickBooks Customer format
 */
function mapLocalCustomerToQB(customer: Customer): any {
  const qbCustomer: any = {
    DisplayName: customer.companyName,
  };

  if (customer.email) {
    qbCustomer.PrimaryEmailAddr = { Address: customer.email };
  }

  if (customer.phone) {
    qbCustomer.PrimaryPhone = { FreeFormNumber: customer.phone };
  }

  if (customer.website) {
    qbCustomer.WebAddr = { URI: customer.website };
  }

  if (customer.billingAddress) {
    qbCustomer.BillAddr = parseLocalAddress(customer.billingAddress);
  }

  if (customer.shippingAddress) {
    qbCustomer.ShipAddr = parseLocalAddress(customer.shippingAddress);
  }

  if (customer.notes) {
    qbCustomer.Notes = customer.notes;
  }

  return qbCustomer;
}

/**
 * Format QuickBooks address to local text format
 */
function formatQBAddress(qbAddr: any): string {
  const parts = [
    qbAddr.Line1,
    qbAddr.Line2,
    qbAddr.Line3,
    qbAddr.City,
    qbAddr.CountrySubDivisionCode,
    qbAddr.PostalCode,
    qbAddr.Country,
  ].filter(Boolean);
  return parts.join(', ');
}

/**
 * Parse local address text to QuickBooks address format
 */
function parseLocalAddress(address: string): any {
  // Simple parsing - split by comma
  const parts = address.split(',').map(p => p.trim());
  return {
    Line1: parts[0] || '',
    City: parts.length > 2 ? parts[parts.length - 3] : '',
    CountrySubDivisionCode: parts.length > 1 ? parts[parts.length - 2] : '',
    PostalCode: parts.length > 0 ? parts[parts.length - 1] : '',
  };
}

/**
 * Make authenticated request to QuickBooks API
 */
async function makeQBRequest(
  method: 'GET' | 'POST' | 'PUT',
  endpoint: string,
  body?: any
): Promise<any> {
  const connection = await getActiveConnection();
  if (!connection) {
    throw new Error('QuickBooks not connected');
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Failed to get valid access token');
  }

  const baseUrl = process.env.QUICKBOOKS_ENVIRONMENT === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';

  const url = `${baseUrl}/v3/company/${connection.companyId}${endpoint}`;

  const options: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  };

  if (body && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`QuickBooks API error: ${response.status} ${errorText}`);
  }

  return await response.json();
}

// ==================== Customer Sync Processors ====================

/**
 * Process pull sync: Fetch customers from QuickBooks and upsert into local DB
 */
export async function processPullCustomers(jobId: string): Promise<void> {
  try {
    console.log(`[QB Pull Customers] Starting job ${jobId}`);

    // Update job status to processing
    await db
      .update(accountingSyncJobs)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(accountingSyncJobs.id, jobId));

    // Fetch all customers from QuickBooks
    const query = "SELECT * FROM Customer";
    const response = await makeQBRequest('GET', `/query?query=${encodeURIComponent(query)}`);

    const qbCustomers = response.QueryResponse?.Customer || [];
    console.log(`[QB Pull Customers] Found ${qbCustomers.length} customers in QuickBooks`);

    let syncedCount = 0;
    let errorCount = 0;

    for (const qbCustomer of qbCustomers) {
      try {
        const localData = mapQBCustomerToLocal(qbCustomer);

        // Check if customer exists by external ID or email
        const [existing] = await db
          .select()
          .from(customers)
          .where(
            or(
              eq(customers.externalAccountingId, qbCustomer.Id),
              localData.email ? eq(customers.email, localData.email) : sql`false`
            )
          )
          .limit(1);

        if (existing) {
          // Update existing customer
          await db
            .update(customers)
            .set({
              ...localData,
              updatedAt: new Date(),
            })
            .where(eq(customers.id, existing.id));
          console.log(`[QB Pull Customers] Updated customer: ${localData.companyName}`);
        } else {
          // Create new customer
          await db.insert(customers).values({
            ...localData,
            customerType: 'business',
            status: 'active',
          } as any);
          console.log(`[QB Pull Customers] Created customer: ${localData.companyName}`);
        }

        syncedCount++;
      } catch (error: any) {
        console.error(`[QB Pull Customers] Error syncing customer ${qbCustomer.DisplayName}:`, error);
        errorCount++;
      }
    }

    // Update job status to completed
    await db
      .update(accountingSyncJobs)
      .set({
        status: 'synced',
        updatedAt: new Date(),
        payloadJson: { syncedCount, errorCount, total: qbCustomers.length } as any,
      })
      .where(eq(accountingSyncJobs.id, jobId));

    console.log(`[QB Pull Customers] Completed: ${syncedCount} synced, ${errorCount} errors`);
  } catch (error: any) {
    console.error(`[QB Pull Customers] Job failed:`, error);
    await db
      .update(accountingSyncJobs)
      .set({
        status: 'error',
        error: error.message,
        updatedAt: new Date(),
      })
      .where(eq(accountingSyncJobs.id, jobId));
    throw error;
  }
}

/**
 * Process push sync: Push local customers to QuickBooks
 */
export async function processPushCustomers(jobId: string): Promise<void> {
  try {
    console.log(`[QB Push Customers] Starting job ${jobId}`);

    // Update job status to processing
    await db
      .update(accountingSyncJobs)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(accountingSyncJobs.id, jobId));

    // Find local customers that need to be synced (no external ID or pending status)
    const localCustomers = await db
      .select()
      .from(customers)
      .where(
        or(
          isNull(customers.externalAccountingId),
          eq(customers.syncStatus, 'pending')
        )
      );

    console.log(`[QB Push Customers] Found ${localCustomers.length} customers to sync`);

    let syncedCount = 0;
    let errorCount = 0;

    for (const customer of localCustomers) {
      try {
        const qbCustomerData = mapLocalCustomerToQB(customer);

        let qbCustomer;
        if (customer.externalAccountingId) {
          // Update existing QB customer
          // First fetch to get SyncToken
          const existing = await makeQBRequest(
            'GET',
            `/customer/${customer.externalAccountingId}`
          );
          qbCustomerData.Id = customer.externalAccountingId;
          qbCustomerData.SyncToken = existing.Customer.SyncToken;

          const response = await makeQBRequest('POST', '/customer', qbCustomerData);
          qbCustomer = response.Customer;
          console.log(`[QB Push Customers] Updated QB customer: ${customer.companyName}`);
        } else {
          // Create new QB customer
          const response = await makeQBRequest('POST', '/customer', qbCustomerData);
          qbCustomer = response.Customer;
          console.log(`[QB Push Customers] Created QB customer: ${customer.companyName}`);
        }

        // Update local customer with QB ID
        await db
          .update(customers)
          .set({
            externalAccountingId: qbCustomer.Id,
            syncStatus: 'synced',
            syncError: null,
            syncedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(customers.id, customer.id));

        syncedCount++;
      } catch (error: any) {
        console.error(`[QB Push Customers] Error syncing customer ${customer.companyName}:`, error);
        
        // Update customer with error status
        await db
          .update(customers)
          .set({
            syncStatus: 'error',
            syncError: error.message,
            updatedAt: new Date(),
          })
          .where(eq(customers.id, customer.id));

        errorCount++;
      }
    }

    // Update job status to completed
    await db
      .update(accountingSyncJobs)
      .set({
        status: 'synced',
        updatedAt: new Date(),
        payloadJson: { syncedCount, errorCount, total: localCustomers.length } as any,
      })
      .where(eq(accountingSyncJobs.id, jobId));

    console.log(`[QB Push Customers] Completed: ${syncedCount} synced, ${errorCount} errors`);
  } catch (error: any) {
    console.error(`[QB Push Customers] Job failed:`, error);
    await db
      .update(accountingSyncJobs)
      .set({
        status: 'error',
        error: error.message,
        updatedAt: new Date(),
      })
      .where(eq(accountingSyncJobs.id, jobId));
    throw error;
  }
}

/**
 * Process pull sync: Fetch invoices from QuickBooks
 */
export async function processPullInvoices(jobId: string): Promise<void> {
  try {
    console.log(`[QB Pull Invoices] Starting job ${jobId}`);

    await db
      .update(accountingSyncJobs)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(accountingSyncJobs.id, jobId));

    const query = "SELECT * FROM Invoice";
    const response = await makeQBRequest('GET', `/query?query=${encodeURIComponent(query)}`);

    const qbInvoices = response.QueryResponse?.Invoice || [];
    console.log(`[QB Pull Invoices] Found ${qbInvoices.length} invoices in QuickBooks`);

    let syncedCount = 0;
    let errorCount = 0;

    for (const qbInvoice of qbInvoices) {
      try {
        // Map QB invoice to local format
        const localData = {
          invoiceNumber: parseInt(qbInvoice.DocNumber) || 0,
          customerId: null, // Need to match QB customer to local
          status: mapQBInvoiceStatus(qbInvoice.Balance > 0 ? 'unpaid' : 'paid'),
          issueDate: new Date(qbInvoice.TxnDate),
          dueDate: qbInvoice.DueDate ? new Date(qbInvoice.DueDate) : null,
          subtotal: qbInvoice.TotalAmt?.toString() || '0',
          tax: qbInvoice.TxnTaxDetail?.TotalTax?.toString() || '0',
          total: qbInvoice.TotalAmt?.toString() || '0',
          balanceDue: qbInvoice.Balance?.toString() || '0',
          externalAccountingId: qbInvoice.Id,
          syncStatus: 'synced',
          syncedAt: new Date(),
        };

        // Try to find matching local customer by QB customer ID
        if (qbInvoice.CustomerRef?.value) {
          const [matchedCustomer] = await db
            .select()
            .from(customers)
            .where(eq(customers.externalAccountingId, qbInvoice.CustomerRef.value))
            .limit(1);

          if (matchedCustomer) {
            localData.customerId = matchedCustomer.id;
          }
        }

        // Skip if no customer match found
        if (!localData.customerId) {
          console.warn(`[QB Pull Invoices] Skipping invoice ${qbInvoice.DocNumber} - no matching customer`);
          continue;
        }

        // Check if invoice exists
        const [existing] = await db
          .select()
          .from(invoices)
          .where(eq(invoices.externalAccountingId, qbInvoice.Id))
          .limit(1);

        if (existing) {
          await db
            .update(invoices)
            .set({ ...localData, updatedAt: new Date() })
            .where(eq(invoices.id, existing.id));
          console.log(`[QB Pull Invoices] Updated invoice: ${qbInvoice.DocNumber}`);
        } else {
          // Would need createdByUserId - skip creation for now
          console.warn(`[QB Pull Invoices] Skipping new invoice ${qbInvoice.DocNumber} - requires user context`);
        }

        syncedCount++;
      } catch (error: any) {
        console.error(`[QB Pull Invoices] Error syncing invoice ${qbInvoice.DocNumber}:`, error);
        errorCount++;
      }
    }

    await db
      .update(accountingSyncJobs)
      .set({
        status: 'synced',
        updatedAt: new Date(),
        payloadJson: { syncedCount, errorCount, total: qbInvoices.length } as any,
      })
      .where(eq(accountingSyncJobs.id, jobId));

    console.log(`[QB Pull Invoices] Completed: ${syncedCount} synced, ${errorCount} errors`);
  } catch (error: any) {
    console.error(`[QB Pull Invoices] Job failed:`, error);
    await db
      .update(accountingSyncJobs)
      .set({ status: 'error', error: error.message, updatedAt: new Date() })
      .where(eq(accountingSyncJobs.id, jobId));
    throw error;
  }
}

/**
 * Process push sync: Push local invoices to QuickBooks
 */
export async function processPushInvoices(jobId: string): Promise<void> {
  try {
    console.log(`[QB Push Invoices] Starting job ${jobId}`);

    await db
      .update(accountingSyncJobs)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(accountingSyncJobs.id, jobId));

    const localInvoices = await db
      .select()
      .from(invoices)
      .where(
        or(
          isNull(invoices.externalAccountingId),
          eq(invoices.syncStatus, 'pending')
        )
      );

    console.log(`[QB Push Invoices] Found ${localInvoices.length} invoices to sync`);

    let syncedCount = 0;
    let errorCount = 0;

    for (const invoice of localInvoices) {
      try {
        // Get customer's QB ID
        const [customer] = await db
          .select()
          .from(customers)
          .where(eq(customers.id, invoice.customerId))
          .limit(1);

        if (!customer?.externalAccountingId) {
          throw new Error('Customer not synced to QuickBooks');
        }

        // Build QB invoice
        const qbInvoiceData: any = {
          CustomerRef: { value: customer.externalAccountingId },
          TxnDate: invoice.issueDate.toISOString().split('T')[0],
          DueDate: invoice.dueDate?.toISOString().split('T')[0],
          Line: [], // Would need line items from invoice_line_items table
        };

        let qbInvoice;
        if (invoice.externalAccountingId) {
          // Update existing
          const existing = await makeQBRequest('GET', `/invoice/${invoice.externalAccountingId}`);
          qbInvoiceData.Id = invoice.externalAccountingId;
          qbInvoiceData.SyncToken = existing.Invoice.SyncToken;
          const response = await makeQBRequest('POST', '/invoice', qbInvoiceData);
          qbInvoice = response.Invoice;
        } else {
          // Create new
          const response = await makeQBRequest('POST', '/invoice', qbInvoiceData);
          qbInvoice = response.Invoice;
        }

        await db
          .update(invoices)
          .set({
            externalAccountingId: qbInvoice.Id,
            syncStatus: 'synced',
            syncError: null,
            syncedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(invoices.id, invoice.id));

        syncedCount++;
      } catch (error: any) {
        console.error(`[QB Push Invoices] Error syncing invoice ${invoice.invoiceNumber}:`, error);
        await db
          .update(invoices)
          .set({ syncStatus: 'error', syncError: error.message, updatedAt: new Date() })
          .where(eq(invoices.id, invoice.id));
        errorCount++;
      }
    }

    await db
      .update(accountingSyncJobs)
      .set({
        status: 'synced',
        updatedAt: new Date(),
        payloadJson: { syncedCount, errorCount, total: localInvoices.length } as any,
      })
      .where(eq(accountingSyncJobs.id, jobId));

    console.log(`[QB Push Invoices] Completed: ${syncedCount} synced, ${errorCount} errors`);
  } catch (error: any) {
    console.error(`[QB Push Invoices] Job failed:`, error);
    await db
      .update(accountingSyncJobs)
      .set({ status: 'error', error: error.message, updatedAt: new Date() })
      .where(eq(accountingSyncJobs.id, jobId));
    throw error;
  }
}

/**
 * Map QB invoice status to local status
 */
function mapQBInvoiceStatus(qbStatus: string): string {
  const statusMap: Record<string, string> = {
    'unpaid': 'sent',
    'paid': 'paid',
    'partial': 'partially_paid',
  };
  return statusMap[qbStatus] || 'draft';
}

/**
 * Process pull sync: Fetch orders/sales receipts from QuickBooks
 */
export async function processPullOrders(jobId: string): Promise<void> {
  try {
    console.log(`[QB Pull Orders] Starting job ${jobId}`);

    await db
      .update(accountingSyncJobs)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(accountingSyncJobs.id, jobId));

    // QB SalesReceipt is closest to our Order concept
    const query = "SELECT * FROM SalesReceipt";
    const response = await makeQBRequest('GET', `/query?query=${encodeURIComponent(query)}`);

    const qbSalesReceipts = response.QueryResponse?.SalesReceipt || [];
    console.log(`[QB Pull Orders] Found ${qbSalesReceipts.length} sales receipts in QuickBooks`);

    let syncedCount = 0;
    let errorCount = 0;

    for (const qbReceipt of qbSalesReceipts) {
      try {
        // Map QB sales receipt to local order format
        const localData = {
          orderNumber: qbReceipt.DocNumber || `QB-${qbReceipt.Id}`,
          customerId: null,
          status: 'completed',
          priority: 'normal',
          fulfillmentStatus: 'delivered',
          subtotal: qbReceipt.TotalAmt?.toString() || '0',
          tax: qbReceipt.TxnTaxDetail?.TotalTax?.toString() || '0',
          total: qbReceipt.TotalAmt?.toString() || '0',
          externalAccountingId: qbReceipt.Id,
          syncStatus: 'synced',
          syncedAt: new Date(),
        };

        // Find matching customer
        if (qbReceipt.CustomerRef?.value) {
          const [matchedCustomer] = await db
            .select()
            .from(customers)
            .where(eq(customers.externalAccountingId, qbReceipt.CustomerRef.value))
            .limit(1);

          if (matchedCustomer) {
            localData.customerId = matchedCustomer.id;
          }
        }

        if (!localData.customerId) {
          console.warn(`[QB Pull Orders] Skipping sales receipt ${qbReceipt.DocNumber} - no matching customer`);
          continue;
        }

        // Check if order exists
        const [existing] = await db
          .select()
          .from(orders)
          .where(eq(orders.externalAccountingId, qbReceipt.Id))
          .limit(1);

        if (existing) {
          await db
            .update(orders)
            .set({ ...localData, updatedAt: new Date() })
            .where(eq(orders.id, existing.id));
          console.log(`[QB Pull Orders] Updated order: ${qbReceipt.DocNumber}`);
        } else {
          console.warn(`[QB Pull Orders] Skipping new order ${qbReceipt.DocNumber} - requires user context`);
        }

        syncedCount++;
      } catch (error: any) {
        console.error(`[QB Pull Orders] Error syncing sales receipt ${qbReceipt.DocNumber}:`, error);
        errorCount++;
      }
    }

    await db
      .update(accountingSyncJobs)
      .set({
        status: 'synced',
        updatedAt: new Date(),
        payloadJson: { syncedCount, errorCount, total: qbSalesReceipts.length } as any,
      })
      .where(eq(accountingSyncJobs.id, jobId));

    console.log(`[QB Pull Orders] Completed: ${syncedCount} synced, ${errorCount} errors`);
  } catch (error: any) {
    console.error(`[QB Pull Orders] Job failed:`, error);
    await db
      .update(accountingSyncJobs)
      .set({ status: 'error', error: error.message, updatedAt: new Date() })
      .where(eq(accountingSyncJobs.id, jobId));
    throw error;
  }
}

/**
 * Process push sync: Push local orders to QuickBooks as SalesReceipts
 */
export async function processPushOrders(jobId: string): Promise<void> {
  try {
    console.log(`[QB Push Orders] Starting job ${jobId}`);

    await db
      .update(accountingSyncJobs)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(accountingSyncJobs.id, jobId));

    // Only sync completed/paid orders
    const localOrders = await db
      .select()
      .from(orders)
      .where(
        and(
          or(
            isNull(orders.externalAccountingId),
            eq(orders.syncStatus, 'pending')
          ),
          eq(orders.status, 'completed')
        )
      );

    console.log(`[QB Push Orders] Found ${localOrders.length} orders to sync`);

    let syncedCount = 0;
    let errorCount = 0;

    for (const order of localOrders) {
      try {
        const [customer] = await db
          .select()
          .from(customers)
          .where(eq(customers.id, order.customerId))
          .limit(1);

        if (!customer?.externalAccountingId) {
          throw new Error('Customer not synced to QuickBooks');
        }

        // Build QB sales receipt
        const qbReceiptData: any = {
          CustomerRef: { value: customer.externalAccountingId },
          TxnDate: order.createdAt.toISOString().split('T')[0],
          Line: [], // Would need line items
        };

        const response = await makeQBRequest('POST', '/salesreceipt', qbReceiptData);
        const qbReceipt = response.SalesReceipt;

        await db
          .update(orders)
          .set({
            externalAccountingId: qbReceipt.Id,
            syncStatus: 'synced',
            syncError: null,
            syncedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(orders.id, order.id));

        syncedCount++;
      } catch (error: any) {
        console.error(`[QB Push Orders] Error syncing order ${order.orderNumber}:`, error);
        await db
          .update(orders)
          .set({ syncStatus: 'error', syncError: error.message, updatedAt: new Date() })
          .where(eq(orders.id, order.id));
        errorCount++;
      }
    }

    await db
      .update(accountingSyncJobs)
      .set({
        status: 'synced',
        updatedAt: new Date(),
        payloadJson: { syncedCount, errorCount, total: localOrders.length } as any,
      })
      .where(eq(accountingSyncJobs.id, jobId));

    console.log(`[QB Push Orders] Completed: ${syncedCount} synced, ${errorCount} errors`);
  } catch (error: any) {
    console.error(`[QB Push Orders] Job failed:`, error);
    await db
      .update(accountingSyncJobs)
      .set({ status: 'error', error: error.message, updatedAt: new Date() })
      .where(eq(accountingSyncJobs.id, jobId));
    throw error;
  }
}
