/**
 * customerRelations.routes.ts
 *
 * Customer Contacts, Customer Notes, and Customer Credit Transactions routes
 * extracted from server/routes.ts.
 *
 * Routes:
 *   GET    /api/customers/:customerId/contacts
 *   GET    /api/contacts
 *   GET    /api/contacts/:id
 *   POST   /api/customers/:customerId/contacts
 *   PATCH  /api/customer-contacts/:id
 *   DELETE /api/customer-contacts/:id
 *
 *   GET    /api/customers/:customerId/notes
 *   POST   /api/customers/:customerId/notes
 *   PATCH  /api/customer-notes/:id
 *   DELETE /api/customer-notes/:id
 *
 *   GET    /api/customers/:customerId/credit-transactions
 *   POST   /api/customers/:customerId/credit-transactions
 *   PATCH  /api/customer-credit-transactions/:id
 *   POST   /api/customers/:customerId/apply-credit
 *
 * Placement: server/routes/customerRelations.routes.ts
 * Registered by: server/routes.ts via registerCustomerRelationsRoutes
 */

import type { Express } from "express";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { eq, desc, and, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db } from "../db";
import { orders, quotes, invoices, payments, customerCreditTransactions } from "@shared/schema";
import {
  insertCustomerContactSchema,
  updateCustomerContactSchema,
  insertCustomerNoteSchema,
  updateCustomerNoteSchema,
  insertCustomerCreditTransactionSchema,
  updateCustomerCreditTransactionSchema,
} from "@shared/schema";
import { storage } from "../storage";
import { getRequestOrganizationId } from "../tenantContext";

function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

export function registerCustomerRelationsRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    isAdmin: any;
  },
): void {
  const { isAuthenticated, tenantContext, isAdmin } = middleware;

  // ============================================================
  // CUSTOMER CONTACTS
  // ============================================================

  app.get("/api/customers/:customerId/contacts", isAuthenticated, async (req, res) => {
    try {
      const contacts = await storage.getCustomerContacts(req.params.customerId);
      res.json(contacts);
    } catch (error) {
      console.error("Error fetching customer contacts:", error);
      res.status(500).json({ message: "Failed to fetch customer contacts" });
    }
  });

  // Global contacts list with search and pagination
  app.get("/api/contacts", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const search = req.query.search as string | undefined;
      const page = req.query.page ? parseInt(req.query.page as string) : 1;
      const pageSize = Math.min(200, req.query.pageSize ? parseInt(req.query.pageSize as string) : 50);

      const result = await storage.getContactsPaged(organizationId, { search, page, pageSize });
      res.json({
        contacts: result.items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
        hasNextPage: result.hasNextPage,
        hasPreviousPage: result.hasPreviousPage,
      });
    } catch (error) {
      console.error("Error fetching contacts:", error);
      res.status(500).json({ message: "Failed to fetch contacts" });
    }
  });

  // Contact detail with relations
  app.get("/api/contacts/:id", isAuthenticated, async (req, res) => {
    try {
      const contactWithCustomer = await storage.getContactWithRelations(req.params.id);
      if (!contactWithCustomer) {
        return res.status(404).json({ message: "Contact not found" });
      }

      const { customer, ...contact } = contactWithCustomer;

      // Fetch recent orders for this contact
      const recentOrdersQuery = await db
        .select()
        .from(orders)
        .where(eq(orders.contactId, contact.id))
        .orderBy(desc(orders.createdAt))
        .limit(10);

      // Fetch recent quotes for this contact
      const recentQuotesQuery = await db
        .select()
        .from(quotes)
        .where(eq(quotes.contactId, contact.id))
        .orderBy(desc(quotes.createdAt))
        .limit(10);

      res.json({
        contact,
        customer: customer || null,
        recentOrders: recentOrdersQuery || [],
        recentQuotes: recentQuotesQuery || [],
      });
    } catch (error) {
      console.error("Error fetching contact detail:", error);
      res.status(500).json({ message: "Failed to fetch contact detail" });
    }
  });

  app.post("/api/customers/:customerId/contacts", isAuthenticated, async (req, res) => {
    try {
      const contactData = insertCustomerContactSchema.parse({
        ...req.body,
        customerId: req.params.customerId,
      });
      const contact = await storage.createCustomerContact(contactData);
      res.json(contact);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating customer contact:", error);
      res.status(500).json({ message: "Failed to create customer contact" });
    }
  });

  app.patch("/api/customer-contacts/:id", isAuthenticated, async (req, res) => {
    try {
      const contactData = updateCustomerContactSchema.parse(req.body);
      const contact = await storage.updateCustomerContact(req.params.id, contactData);
      res.json(contact);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating customer contact:", error);
      res.status(500).json({ message: "Failed to update customer contact" });
    }
  });

  app.delete("/api/customer-contacts/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const contactId = req.params.id;

      // Get contact details before deletion for audit log
      const contact = await storage.getCustomerContactById(contactId);
      if (!contact) {
        return res.status(404).json({ message: "Contact not found" });
      }

      // Delete the contact
      await storage.deleteCustomerContact(contactId);

      // Create audit log
      const userId = getUserId(req.user);
      const userName = req.user?.name || req.user?.email || 'Unknown';
      await storage.createAuditLog(organizationId, {
        userId,
        userName,
        actionType: 'delete',
        entityType: 'contact',
        entityId: contactId,
        entityName: `${contact.firstName} ${contact.lastName}`,
        description: `Deleted contact ${contact.firstName} ${contact.lastName} (${contact.email || 'no email'})`,
        oldValues: contact,
        newValues: null,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
      });

      res.json({ message: "Customer contact deleted successfully" });
    } catch (error) {
      console.error("Error deleting customer contact:", error);
      res.status(500).json({ message: "Failed to delete customer contact" });
    }
  });

  // ============================================================
  // CUSTOMER NOTES
  // ============================================================

  app.get("/api/customers/:customerId/notes", isAuthenticated, async (req, res) => {
    try {
      const filters = {
        noteType: req.query.noteType as string | undefined,
        assignedTo: req.query.assignedTo as string | undefined,
      };
      const notes = await storage.getCustomerNotes(req.params.customerId, filters);
      res.json(notes);
    } catch (error) {
      console.error("Error fetching customer notes:", error);
      res.status(500).json({ message: "Failed to fetch customer notes" });
    }
  });

  app.post("/api/customers/:customerId/notes", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const noteData = insertCustomerNoteSchema.parse({
        ...req.body,
        customerId: req.params.customerId,
        createdBy: userId,
      });
      const note = await storage.createCustomerNote(noteData);
      res.json(note);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating customer note:", error);
      res.status(500).json({ message: "Failed to create customer note" });
    }
  });

  app.patch("/api/customer-notes/:id", isAuthenticated, async (req, res) => {
    try {
      const noteData = updateCustomerNoteSchema.parse(req.body);
      const note = await storage.updateCustomerNote(req.params.id, noteData);
      res.json(note);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating customer note:", error);
      res.status(500).json({ message: "Failed to update customer note" });
    }
  });

  app.delete("/api/customer-notes/:id", isAuthenticated, async (req, res) => {
    try {
      await storage.deleteCustomerNote(req.params.id);
      res.json({ message: "Customer note deleted successfully" });
    } catch (error) {
      console.error("Error deleting customer note:", error);
      res.status(500).json({ message: "Failed to delete customer note" });
    }
  });

  // ============================================================
  // CUSTOMER CREDIT TRANSACTIONS
  // ============================================================

  app.get("/api/customers/:customerId/credit-transactions", isAuthenticated, async (req, res) => {
    try {
      const transactions = await storage.getCustomerCreditTransactions(req.params.customerId);
      res.json(transactions);
    } catch (error) {
      console.error("Error fetching customer credit transactions:", error);
      res.status(500).json({ message: "Failed to fetch customer credit transactions" });
    }
  });

  app.post("/api/customers/:customerId/credit-transactions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      const transactionData = insertCustomerCreditTransactionSchema.parse({
        ...req.body,
        customerId: req.params.customerId,
        createdBy: userId,
      });
      const transaction = await storage.createCustomerCreditTransaction(transactionData);
      res.json(transaction);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating customer credit transaction:", error);
      res.status(500).json({ message: "Failed to create customer credit transaction" });
    }
  });

  app.patch("/api/customer-credit-transactions/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const transactionData = updateCustomerCreditTransactionSchema.parse(req.body);
      const transaction = await storage.updateCustomerCreditTransaction(req.params.id, transactionData);
      res.json(transaction);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating customer credit transaction:", error);
      res.status(500).json({ message: "Failed to update customer credit transaction" });
    }
  });

  app.post("/api/customers/:customerId/apply-credit", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      const { amount, type, reason } = req.body;

      if (!amount || !type || !reason) {
        return res.status(400).json({ message: "Amount, type, and reason are required" });
      }

      const customer = await storage.updateCustomerBalance(
        organizationId,
        req.params.customerId,
        parseFloat(amount),
        type,
        reason,
        userId!
      );
      res.json(customer);
    } catch (error) {
      console.error("Error applying credit to customer:", error);
      res.status(500).json({ message: "Failed to apply credit to customer" });
    }
  });

  // ============================================================
  // CUSTOMER TRANSACTION REPORT
  // GET /api/customers/:id/transactions
  //
  // Query params:
  //   dateFrom   ISO date string (optional)
  //   dateTo     ISO date string (optional)
  //   search     string (optional)
  //   type       comma-separated: quote,order,invoice,payment,credit,adjustment (optional)
  //   sort       "asc" | "desc"  (default "desc")
  //   page       integer (default 1)
  //   pageSize   integer (default 50, max 100)
  //
  // Response:
  //   { rows, summary: { invoicedTotal, paidTotal, openBalance, creditsTotal }, pagination }
  // ============================================================

  app.get("/api/customers/:id/transactions", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const customerId = req.params.id;

      // Validate customer belongs to this org
      const customer = await storage.getCustomerById(organizationId, customerId);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }

      // Parse filters — keep dateFrom/dateTo as ISO strings (PgTimestampString columns compare with strings)
      const dateFrom = (req.query.dateFrom as string) || null;
      const dateTo = (req.query.dateTo as string) || null;
      const search = ((req.query.search as string) || "").toLowerCase().trim();
      const typeFilter: string[] | null = req.query.type
        ? (req.query.type as string).split(",").map((t) => t.trim())
        : null;
      const sort = req.query.sort === "asc" ? "asc" : "desc";
      const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
      const pageSize = Math.min(100, Math.max(1, parseInt((req.query.pageSize as string) || "50", 10)));

      type TxRow = {
        id: string;
        date: string;
        type: string;
        referenceNumber: string;
        description: string;
        status: string;
        amount: string;
        balanceImpact: string | null;
        method: string | null;
        linkType: string | null;
        linkId: string | null;
      };

      const rows: TxRow[] = [];

      // ── QUOTES ──
      if (!typeFilter || typeFilter.includes("quote")) {
        const dateFilters: SQL<unknown>[] = [];
        if (dateFrom) dateFilters.push(sql`${quotes.createdAt} >= ${dateFrom}`);
        if (dateTo) dateFilters.push(sql`${quotes.createdAt} <= ${dateTo}`);

        const quoteRows = await db
          .select({
            id: quotes.id,
            createdAt: quotes.createdAt,
            quoteNumber: quotes.quoteNumber,
            label: quotes.label,
            status: quotes.status,
            totalPrice: quotes.totalPrice,
          })
          .from(quotes)
          .where(and(eq(quotes.organizationId, organizationId), eq(quotes.customerId, customerId), ...dateFilters));

        for (const q of quoteRows) {
          const refNum = q.quoteNumber != null ? `Q-${q.quoteNumber}` : "—";
          const descText = q.label || "Quote";
          if (search && !refNum.toLowerCase().includes(search) && !descText.toLowerCase().includes(search)) continue;
          rows.push({
            id: `quote-${q.id}`,
            date: new Date(q.createdAt as any).toISOString(),
            type: "quote",
            referenceNumber: refNum,
            description: descText,
            status: (q.status as string) || "active",
            amount: q.totalPrice || "0",
            balanceImpact: null,
            method: null,
            linkType: "quote",
            linkId: q.id,
          });
        }
      }

      // ── ORDERS ──
      if (!typeFilter || typeFilter.includes("order")) {
        const dateFilters: SQL<unknown>[] = [];
        if (dateFrom) dateFilters.push(sql`${orders.createdAt} >= ${dateFrom}`);
        if (dateTo) dateFilters.push(sql`${orders.createdAt} <= ${dateTo}`);

        const orderRows = await db
          .select({
            id: orders.id,
            createdAt: orders.createdAt,
            orderNumber: orders.orderNumber,
            label: orders.label,
            status: orders.status,
            total: orders.total,
          })
          .from(orders)
          .where(and(eq(orders.organizationId, organizationId), eq(orders.customerId, customerId), ...dateFilters));

        for (const o of orderRows) {
          const refNum = `ORD-${o.orderNumber}`;
          const descText = o.label || "Order";
          if (search && !refNum.toLowerCase().includes(search) && !descText.toLowerCase().includes(search)) continue;
          rows.push({
            id: `order-${o.id}`,
            date: new Date(o.createdAt as any).toISOString(),
            type: "order",
            referenceNumber: refNum,
            description: descText,
            status: o.status || "new",
            amount: o.total || "0",
            balanceImpact: null,
            method: null,
            linkType: "order",
            linkId: o.id,
          });
        }
      }

      // ── INVOICES ──
      if (!typeFilter || typeFilter.includes("invoice")) {
        const dateFilters: SQL<unknown>[] = [];
        if (dateFrom) dateFilters.push(sql`${invoices.createdAt} >= ${dateFrom}`);
        if (dateTo) dateFilters.push(sql`${invoices.createdAt} <= ${dateTo}`);

        const invoiceRows = await db
          .select({
            id: invoices.id,
            createdAt: invoices.createdAt,
            invoiceNumber: invoices.invoiceNumber,
            status: invoices.status,
            total: invoices.total,
            balanceDue: invoices.balanceDue,
            notesPublic: invoices.notesPublic,
          })
          .from(invoices)
          .where(and(eq(invoices.organizationId, organizationId), eq(invoices.customerId, customerId), ...dateFilters));

        for (const inv of invoiceRows) {
          const refNum = `INV-${inv.invoiceNumber}`;
          const descText = inv.notesPublic || "Invoice";
          if (search && !refNum.toLowerCase().includes(search) && !descText.toLowerCase().includes(search)) continue;
          rows.push({
            id: `invoice-${inv.id}`,
            date: new Date(inv.createdAt as any).toISOString(),
            type: "invoice",
            referenceNumber: refNum,
            description: descText,
            status: inv.status || "draft",
            amount: inv.total || "0",
            balanceImpact: inv.balanceDue || "0",
            method: null,
            linkType: "invoice",
            linkId: inv.id,
          });
        }
      }

      // ── PAYMENTS (via invoice join for customerId) ──
      if (!typeFilter || typeFilter.includes("payment")) {
        const dateFilters: SQL<unknown>[] = [];
        if (dateFrom) dateFilters.push(sql`${payments.createdAt} >= ${dateFrom}`);
        if (dateTo) dateFilters.push(sql`${payments.createdAt} <= ${dateTo}`);

        const paymentRows = await db
          .select({
            id: payments.id,
            createdAt: payments.createdAt,
            amount: payments.amount,
            status: payments.status,
            method: payments.method,
            notes: payments.notes,
            invoiceId: payments.invoiceId,
            invoiceNumber: invoices.invoiceNumber,
          })
          .from(payments)
          .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
          .where(
            and(
              eq(payments.organizationId, organizationId),
              eq(invoices.customerId, customerId),
              ...dateFilters,
            ),
          );

        for (const p of paymentRows) {
          const refNum = p.invoiceNumber != null ? `PMT-INV-${p.invoiceNumber}` : "PMT";
          const descText = p.notes || `Payment — ${p.method || "other"}`;
          if (search && !refNum.toLowerCase().includes(search) && !descText.toLowerCase().includes(search)) continue;
          const amt = p.amount || "0";
          rows.push({
            id: `payment-${p.id}`,
            date: new Date(p.createdAt as any).toISOString(),
            type: "payment",
            referenceNumber: refNum,
            description: descText,
            status: p.status || "succeeded",
            amount: amt,
            balanceImpact: `-${amt}`,
            method: p.method || null,
            linkType: "invoice",
            linkId: p.invoiceId,
          });
        }
      }

      // ── CREDIT / ADJUSTMENT TRANSACTIONS ──
      if (!typeFilter || typeFilter.includes("credit") || typeFilter.includes("adjustment")) {
        const creditRows = await storage.getCustomerCreditTransactions(customerId);
        for (const ct of creditRows) {
          // In-memory date filter (table has no organizationId so we already validated via customer check)
          const ctDate = new Date(ct.createdAt);
          if (dateFrom && ctDate < new Date(dateFrom)) continue;
          if (dateTo && ctDate > new Date(dateTo)) continue;

          const txType = ct.transactionType || "credit";
          // Apply type filter when set
          if (
            typeFilter &&
            !typeFilter.includes(txType) &&
            !typeFilter.includes("credit") &&
            !typeFilter.includes("adjustment")
          ) {
            continue;
          }

          const refNum = ct.referenceNumber || "—";
          const descText = ct.description || txType;
          if (search && !refNum.toLowerCase().includes(search) && !descText.toLowerCase().includes(search)) continue;

          rows.push({
            id: `credit-${ct.id}`,
            date: new Date(ct.createdAt).toISOString(),
            type: txType,
            referenceNumber: refNum,
            description: descText,
            status: "applied",
            amount: ct.amount || "0",
            balanceImpact: ct.amount || "0",
            method: null,
            linkType: null,
            linkId: null,
          });
        }
      }

      // Sort all rows by date
      rows.sort((a, b) => {
        const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
        return sort === "desc" ? -diff : diff;
      });

      // ── SUMMARY TOTALS (computed from full unfiltered data for this customer) ──
      const allInvoices = await db
        .select({ total: invoices.total, balanceDue: invoices.balanceDue, status: invoices.status })
        .from(invoices)
        .where(and(eq(invoices.organizationId, organizationId), eq(invoices.customerId, customerId)));

      const allPayments = await db
        .select({ amount: payments.amount })
        .from(payments)
        .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
        .where(
          and(
            eq(payments.organizationId, organizationId),
            eq(invoices.customerId, customerId),
            eq(payments.status, "succeeded"),
          ),
        );

      const allCreditTx = await storage.getCustomerCreditTransactions(customerId);

      const invoicedTotal = allInvoices.reduce((s, inv) => s + parseFloat(inv.total || "0"), 0);
      const paidTotal = allPayments.reduce((s, p) => s + parseFloat(p.amount || "0"), 0);
      const openBalance = allInvoices.reduce((s, inv) => {
        const voidOrPaid = inv.status === "paid" || inv.status === "void";
        return voidOrPaid ? s : s + parseFloat(inv.balanceDue || "0");
      }, 0);
      const creditsTotal = allCreditTx
        .filter((ct) => ct.transactionType === "payment" || ct.transactionType === "credit")
        .reduce((s, ct) => s + parseFloat(ct.amount || "0"), 0);

      // Paginate
      const total = rows.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const paginatedRows = rows.slice((page - 1) * pageSize, page * pageSize);

      res.json({
        rows: paginatedRows,
        summary: {
          invoicedTotal: invoicedTotal.toFixed(2),
          paidTotal: paidTotal.toFixed(2),
          openBalance: openBalance.toFixed(2),
          creditsTotal: creditsTotal.toFixed(2),
        },
        pagination: {
          total,
          page,
          pageSize,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      });
    } catch (error) {
      console.error("Error fetching customer transactions:", error);
      res.status(500).json({ message: "Failed to fetch customer transactions" });
    }
  });
}
