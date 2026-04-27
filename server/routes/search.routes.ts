/**
 * search.routes.ts
 *
 * Global search route extracted from server/routes.ts.
 *
 * Routes:
 *   GET /api/search
 *
 * Placement: server/routes/search.routes.ts
 * Registered by: server/routes.ts via registerSearchRoutes
 */

import type { Express } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "../db";
import { invoices } from "@shared/schema";
import { storage } from "../storage";
import { getRequestOrganizationId } from "../tenantContext";

export function registerSearchRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
  },
): void {
  const { isAuthenticated, tenantContext } = middleware;

  app.get("/api/search", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      console.log("[GLOBAL SEARCH API] Request received. OrgId:", organizationId);

      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const query = req.query.q as string;
      console.log("[GLOBAL SEARCH API] Query param 'q':", query);

      if (!query || query.length < 2) {
        console.log("[GLOBAL SEARCH API] Query too short or empty, returning empty results");
        return res.json({ customers: [], contacts: [], orders: [], quotes: [], invoices: [], jobs: [] });
      }

      const lowerQuery = query.toLowerCase();
      console.log("[GLOBAL SEARCH API] Searching with lowercase query:", lowerQuery);

      // Search customers
      console.log("[GLOBAL SEARCH API] Calling storage.getAllCustomers...");
      const customersResults = await storage.getAllCustomers(organizationId, { search: query });
      console.log("[GLOBAL SEARCH API] Raw customers results count:", customersResults?.length || 0);
      if (customersResults && customersResults.length > 0) {
        console.log("[GLOBAL SEARCH API] First customer:", customersResults[0]);
      }
      const customers = customersResults.slice(0, 5).map((customer: any) => ({
        id: customer.id,
        title: customer.companyName,
        subtitle: customer.email || customer.phone || undefined,
        url: `/customers/${customer.id}`,
      }));

      // Search contacts
      const contactsResults = await storage.getAllContacts(organizationId, { search: query, page: 1, pageSize: 5 });
      const contacts = contactsResults.slice(0, 5).map((contact: any) => ({
        id: contact.id,
        title: `${contact.firstName} ${contact.lastName}`,
        subtitle: contact.email || contact.companyName || undefined,
        url: `/contacts/${contact.id}`,
      }));

      // Search orders
      const allOrders = await storage.getAllOrders(organizationId);
      const matchingOrders = allOrders
        .filter((order: any) =>
          String(order.orderNumber || '').toLowerCase().includes(lowerQuery) ||
          String(order.jobNumber || '').toLowerCase().includes(lowerQuery) ||
          String(order.customerPO || '').toLowerCase().includes(lowerQuery) ||
          String(order.customerName || '').toLowerCase().includes(lowerQuery)
        )
        .slice(0, 5)
        .map((order: any) => ({
          id: order.id,
          title: `Order #${order.orderNumber || order.id.slice(0, 8)}`,
          subtitle: order.customerName || order.status || undefined,
          url: `/orders/${order.id}`,
        }));

      // Search quotes
      const allQuotes = await storage.getAllQuotes(organizationId);
      const matchingQuotes = allQuotes
        .filter((quote: any) =>
          String(quote.quoteNumber || '').toLowerCase().includes(lowerQuery) ||
          String(quote.customerName || '').toLowerCase().includes(lowerQuery)
        )
        .slice(0, 5)
        .map((quote: any) => ({
          id: quote.id,
          title: `Quote #${quote.quoteNumber || quote.id.slice(0, 8)}`,
          subtitle: quote.customerName || undefined,
          url: `/edit-quote/${quote.id}`,
        }));

      // Search invoices
      const allInvoices = await db
        .select()
        .from(invoices)
        .where(eq(invoices.organizationId, organizationId))
        .orderBy(desc(invoices.createdAt));

      const matchingInvoices = allInvoices
        .filter((invoice: any) =>
          String(invoice.invoiceNumber || '').toLowerCase().includes(lowerQuery) ||
          String(invoice.customerName || '').toLowerCase().includes(lowerQuery)
        )
        .slice(0, 5)
        .map((invoice: any) => ({
          id: invoice.id,
          title: `Invoice #${invoice.invoiceNumber || invoice.id.slice(0, 8)}`,
          subtitle: invoice.customerName || invoice.status || undefined,
          url: `/invoices/${invoice.id}`,
        }));

      // Search jobs (from orders)
      const jobsFromOrders = allOrders
        .filter((order: any) =>
          order.jobNumber && String(order.jobNumber).toLowerCase().includes(lowerQuery)
        )
        .slice(0, 5)
        .map((order: any) => ({
          id: order.id,
          title: `Job ${order.jobNumber}`,
          subtitle: order.customerName || order.status || undefined,
          url: `/production/${order.id}`,
        }));

      const response = {
        customers,
        contacts,
        orders: matchingOrders,
        quotes: matchingQuotes,
        invoices: matchingInvoices,
        jobs: jobsFromOrders,
      };

      console.log("[GLOBAL SEARCH API] Sending response:", {
        customersCount: customers.length,
        contactsCount: contacts.length,
        ordersCount: matchingOrders.length,
        quotesCount: matchingQuotes.length,
        invoicesCount: matchingInvoices.length,
        jobsCount: jobsFromOrders.length,
      });
      console.log("[GLOBAL SEARCH API] First customer in response:", customers[0]);

      res.json(response);
    } catch (error) {
      console.error("[GLOBAL SEARCH API] Error performing search:", error);
      res.status(500).json({ message: "Search failed" });
    }
  });
}
