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
 *   POST   /api/customers/:customerId/contacts/:contactId/link
 *   POST   /api/customer-contacts/:id/set-primary
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
import { auditLogs, orders, quotes, invoices, payments, customerCreditTransactions, customers, customerContacts } from "@shared/schema";
import { resolveDocumentDisplayNumber } from "@shared/documentNumbering";
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
import {
  CanonicalCustomerContactError,
  canonicalCustomerContactOperations,
} from "../services/customers/canonicalCustomerContactOperations";
import {
  safeIso as stmtSafeIso,
  normaliseDateTo,
  orderEffectiveDate,
  isOpenOrder,
  isCompletedOrder,
  filterOrderByStatus,
  filterOrderByDate,
  filterOrderBySearch,
  filterInvoiceBySearch,
  filterQuoteBySearch,
  buildStatementSummary,
} from "../lib/customerStatementHelpers";

const linkExistingContactSchema = z.object({
  setPrimary: z.boolean().optional().default(false),
  confirmMove: z.boolean().optional().default(false),
});

const createCustomerContactRequestSchema = insertCustomerContactSchema.extend({
  isBilling: z.boolean().optional(),
});

const updateCustomerContactRequestSchema = updateCustomerContactSchema.extend({
  relationshipCustomerId: z.string().trim().min(1).optional(),
  isBilling: z.boolean().optional(),
});

function customerLinkContext(customer: { id: string; companyName?: string | null } | null | undefined) {
  if (!customer) return null;
  return {
    id: customer.id,
    companyName: customer.companyName || "Unknown company",
  };
}

export function contactLinkRequiresMoveConfirmation(contactCustomerId: string | null | undefined, targetCustomerId: string) {
  return Boolean(contactCustomerId && contactCustomerId !== targetCustomerId);
}

function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

function jsonError(res: any, status: number, message: string) {
  return res.status(status).json({ success: false, message });
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

  app.get("/api/customers/:customerId/contacts", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return jsonError(res, 500, "Missing organization context");
      const customer = await storage.getCustomerById(organizationId, req.params.customerId);
      if (!customer) return jsonError(res, 404, "Customer not found");
      const contacts = await storage.getCustomerContacts(req.params.customerId);
      res.json(contacts);
    } catch (error) {
      console.error("Error fetching customer contacts:", error);
      jsonError(res, 500, "Failed to fetch customer contacts");
    }
  });

  // Global contacts list with search and pagination
  app.get("/api/contacts", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return jsonError(res, 500, "Missing organization context");
      const search = req.query.search as string | undefined;
      const page = req.query.page ? parseInt(req.query.page as string) : 1;
      const pageSize = Math.min(200, req.query.pageSize ? parseInt(req.query.pageSize as string) : 50);
      const sortBy = req.query.sortBy as string | undefined;
      const sortDir = req.query.sortDir as string | undefined;
      const filter = req.query.filter as string | undefined;
      const customerId = typeof req.query.customerId === "string" && req.query.customerId.trim()
        ? req.query.customerId.trim()
        : undefined;

      const result = await storage.getContactsPaged(organizationId, { search, page, pageSize, sortBy, sortDir, filter, customerId });
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
      jsonError(res, 500, "Failed to fetch contacts");
    }
  });

  // Contact detail with relations
  app.get("/api/contacts/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return jsonError(res, 500, "Missing organization context");
      const contactWithCustomer = await storage.getContactWithRelations(req.params.id, organizationId);
      if (!contactWithCustomer) {
        return jsonError(res, 404, "Contact not found");
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
      jsonError(res, 500, "Failed to fetch contact detail");
    }
  });

  app.post("/api/customers/:customerId/contacts", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return jsonError(res, 500, "Missing organization context");
      const contactData = createCustomerContactRequestSchema.parse({
        ...req.body,
        organizationId,
        customerId: req.params.customerId,
      });
      const { organizationId: _ignoredOrganizationId, customerId, isBilling, ...contactFields } = contactData;
      if (!customerId) return jsonError(res, 400, "Customer is required");
      const actorUserId = getUserId(req.user);
      if (!actorUserId) return jsonError(res, 401, "Authenticated user is required");
      const contact = await canonicalCustomerContactOperations.createContact({
        organizationId,
        actorUserId,
        customerId,
        contact: contactFields,
        isBilling,
      });
      res.json(contact);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return jsonError(res, 400, fromZodError(error).message);
      }
      if (error instanceof Error && error.message === "Customer not found") {
        return jsonError(res, 404, error.message);
      }
      if (error instanceof CanonicalCustomerContactError) return jsonError(res, error.statusCode, error.message);
      console.error("Error creating customer contact:", error);
      jsonError(res, 500, "Failed to create customer contact");
    }
  });

  app.post("/api/contacts", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return jsonError(res, 500, "Missing organization context");
      const contactData = insertCustomerContactSchema.parse({
        ...req.body,
        organizationId,
        customerId: req.body?.customerId ?? null,
        isPrimary: false,
      });
      const { organizationId: _ignoredOrganizationId, customerId, ...contactFields } = contactData;
      const actorUserId = getUserId(req.user);
      if (!actorUserId) return jsonError(res, 401, "Authenticated user is required");
      const contact = await canonicalCustomerContactOperations.createContact({
        organizationId,
        actorUserId,
        customerId,
        contact: contactFields,
      });
      res.json(contact);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return jsonError(res, 400, fromZodError(error).message);
      }
      if (error instanceof Error && error.message === "Customer not found") {
        return jsonError(res, 404, error.message);
      }
      if (error instanceof CanonicalCustomerContactError) return jsonError(res, error.statusCode, error.message);
      console.error("Error creating contact:", error);
      jsonError(res, 500, "Failed to create contact");
    }
  });

  app.post("/api/customers/:customerId/contacts/:contactId/link", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return jsonError(res, 500, "Missing organization context");

      const customerId = String(req.params.customerId || "").trim();
      const contactId = String(req.params.contactId || "").trim();
      const { setPrimary } = linkExistingContactSchema.parse(req.body || {});

      const targetCustomer = await storage.getCustomerById(organizationId, customerId);
      if (!targetCustomer) return jsonError(res, 404, "Customer not found");
      if (["archived", "superseded"].includes(String(targetCustomer.status || "").toLowerCase())) {
        return jsonError(res, 409, `Cannot link contacts to ${targetCustomer.status} customer ${targetCustomer.companyName}. Use the canonical active company record.`);
      }

      const existingContact = await storage.getContactWithRelations(contactId, organizationId);
      if (!existingContact) return jsonError(res, 404, "Contact not found");

      const fromCustomer = customerLinkContext(existingContact.customer);
      const toCustomer = customerLinkContext(targetCustomer);

      const linkedContact = await storage.createCustomerContactLinkForOrganization(
        organizationId,
        customerId,
        contactId,
        {
          isPrimary: setPrimary,
        },
      );

      res.json({
        contact: linkedContact,
        fromCustomer,
        toCustomer,
        moved: false,
        requiresMoveConfirmation: false,
        setPrimary,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return jsonError(res, 400, fromZodError(error).message);
      }
      if (error instanceof Error && (error.message === "Customer contact not found" || error.message === "Customer not found")) {
        return jsonError(res, 404, error.message);
      }
      console.error("Error linking customer contact:", error);
      jsonError(res, 500, "Failed to link contact");
    }
  });

  app.delete("/api/customers/:customerId/contacts/:contactId", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return jsonError(res, 500, "Missing organization context");

      await storage.unlinkCustomerContactForOrganization(organizationId, req.params.customerId, req.params.contactId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error unlinking customer contact:", error);
      jsonError(res, 500, "Failed to unlink contact");
    }
  });

  app.post("/api/customers/:customerId/contacts/:contactId/status", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return jsonError(res, 500, "Missing organization context");
      const status = z.enum(["active", "former", "removed"]).parse(req.body?.status);

      const link = await storage.setCustomerContactLinkStatusForOrganization(
        organizationId,
        req.params.customerId,
        req.params.contactId,
        status,
      );
      res.json(link);
    } catch (error) {
      if (error instanceof z.ZodError) return jsonError(res, 400, fromZodError(error).message);
      if (error instanceof Error && error.message === "Customer contact link not found") return jsonError(res, 404, error.message);
      console.error("Error updating customer contact relationship:", error);
      jsonError(res, 500, "Failed to update contact relationship");
    }
  });

  app.post("/api/customers/:customerId/contacts/:contactId/set-primary", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return jsonError(res, 500, "Missing organization context");

      const contact = await storage.createCustomerContactLinkForOrganization(
        organizationId,
        req.params.customerId,
        req.params.contactId,
        { isPrimary: true, status: "active" },
      );

      res.json(contact);
    } catch (error) {
      if (error instanceof Error && (error.message === "Customer contact not found" || error.message === "Customer not found")) {
        return jsonError(res, 404, error.message);
      }
      console.error("Error setting primary contact:", error);
      jsonError(res, 500, "Failed to set primary contact");
    }
  });

  app.post("/api/customer-contacts/:id/set-primary", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return jsonError(res, 500, "Missing organization context");

      const contactWithCustomer = await storage.getContactWithRelations(req.params.id, organizationId);
      if (!contactWithCustomer) return jsonError(res, 404, "Contact not found");

      const contact = await storage.updateCustomerContactForOrganization(
        organizationId,
        req.params.id,
        { isPrimary: true },
      );

      res.json(contact);
    } catch (error) {
      if (error instanceof Error && (error.message === "Customer contact not found" || error.message === "Customer not found")) {
        return jsonError(res, 404, error.message);
      }
      console.error("Error setting primary contact:", error);
      jsonError(res, 500, "Failed to set primary contact");
    }
  });

  app.patch("/api/customer-contacts/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return jsonError(res, 500, "Missing organization context");
      const contactData = updateCustomerContactRequestSchema.parse(req.body);
      const { relationshipCustomerId, isBilling, ...contactPatch } = contactData;
      const actorUserId = getUserId(req.user);
      if (!actorUserId) return jsonError(res, 401, "Authenticated user is required");
      const contact = await canonicalCustomerContactOperations.updateContact({
        organizationId,
        actorUserId,
        contactId: req.params.id,
        patch: contactPatch,
        customerId: relationshipCustomerId,
        isBilling,
      });
      res.json(contact);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return jsonError(res, 400, fromZodError(error).message);
      }
      if (error instanceof Error && (error.message === "Customer contact not found" || error.message === "Customer not found")) {
        return jsonError(res, 404, error.message);
      }
      if (error instanceof CanonicalCustomerContactError) return jsonError(res, error.statusCode, error.message);
      console.error("Error updating customer contact:", error);
      jsonError(res, 500, "Failed to update customer contact");
    }
  });

  app.delete("/api/customer-contacts/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return jsonError(res, 500, "Missing organization context");
      const contactId = req.params.id;

      // Get contact details before deletion for audit log
      const contact = await storage.getContactWithRelations(contactId, organizationId);
      if (!contact) {
        return jsonError(res, 404, "Contact not found");
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
      jsonError(res, 500, "Failed to delete customer contact");
    }
  });

  // ============================================================
  // CUSTOMER NOTES
  // ============================================================

  app.get("/api/customers/:customerId/notes", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return jsonError(res, 500, "Missing organization context");
      const filters = {
        noteType: req.query.noteType as string | undefined,
        assignedTo: req.query.assignedTo as string | undefined,
      };
      const notes = await storage.getCustomerNotesForOrganization(organizationId, req.params.customerId, filters);
      if (!notes) return jsonError(res, 404, "Customer not found");
      res.json(notes);
    } catch (error) {
      console.error("Error fetching customer notes:", error);
      res.status(500).json({ message: "Failed to fetch customer notes" });
    }
  });

  app.post("/api/customers/:customerId/notes", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return jsonError(res, 500, "Missing organization context");
      const userId = getUserId(req.user);
      const noteData = insertCustomerNoteSchema.parse({
        ...req.body,
        customerId: req.params.customerId,
        userId,
      });
      const note = await storage.createCustomerNoteForOrganization(organizationId, req.params.customerId, noteData);
      if (!note) return jsonError(res, 404, "Customer not found");
      res.json(note);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating customer note:", error);
      res.status(500).json({ message: "Failed to create customer note" });
    }
  });

  app.patch("/api/customer-notes/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return jsonError(res, 500, "Missing organization context");
      const noteData = updateCustomerNoteSchema.parse(req.body);
      const note = await storage.updateCustomerNoteForOrganization(organizationId, req.params.id, noteData);
      if (!note) return jsonError(res, 404, "Customer note not found");
      res.json(note);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating customer note:", error);
      res.status(500).json({ message: "Failed to update customer note" });
    }
  });

  app.delete("/api/customer-notes/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return jsonError(res, 500, "Missing organization context");
      const deleted = await storage.deleteCustomerNoteForOrganization(organizationId, req.params.id);
      if (!deleted) return jsonError(res, 404, "Customer note not found");
      res.json({ message: "Customer note deleted successfully" });
    } catch (error) {
      console.error("Error deleting customer note:", error);
      res.status(500).json({ message: "Failed to delete customer note" });
    }
  });

  // ============================================================
  // CUSTOMER CREDIT TRANSACTIONS
  // ============================================================

  app.get("/api/customers/:customerId/credit-transactions", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return jsonError(res, 500, "Missing organization context");
      const transactions = await storage.getCustomerCreditTransactionsForOrganization(organizationId, req.params.customerId);
      if (!transactions) return jsonError(res, 404, "Customer not found");
      res.json(transactions);
    } catch (error) {
      console.error("Error fetching customer credit transactions:", error);
      res.status(500).json({ message: "Failed to fetch customer credit transactions" });
    }
  });

  app.post("/api/customers/:customerId/credit-transactions", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return jsonError(res, 500, "Missing organization context");
      const userId = getUserId(req.user);
      const transactionData = insertCustomerCreditTransactionSchema.parse({
        ...req.body,
        customerId: req.params.customerId,
        userId,
      });
      const transaction = await storage.createCustomerCreditTransactionForOrganization(
        organizationId,
        req.params.customerId,
        transactionData,
      );
      if (!transaction) return jsonError(res, 404, "Customer not found");
      res.json(transaction);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating customer credit transaction:", error);
      res.status(500).json({ message: "Failed to create customer credit transaction" });
    }
  });

  app.patch("/api/customer-credit-transactions/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return jsonError(res, 500, "Missing organization context");
      const transactionData = updateCustomerCreditTransactionSchema.parse(req.body);
      const transaction = await storage.updateCustomerCreditTransactionForOrganization(
        organizationId,
        req.params.id,
        transactionData,
      );
      if (!transaction) return jsonError(res, 404, "Customer credit transaction not found");
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
  //   dateFrom   ISO date or datetime string (optional â€” inclusive)
  //   dateTo     ISO date or datetime string (optional â€” inclusive, end-of-day if date-only)
  //   search     string (optional â€” searches ref#, PO#, description)
  //   type       comma-separated: quote,order,invoice,payment,refund,credit,adjustment,charge
  //   sort       "asc" | "desc"  (default "desc")
  //   page       integer (default 1)
  //   pageSize   integer (default 50, max 100)
  //
  // Response:
  //   { rows, summary: { invoicedTotal, paidTotal, refundedTotal, openBalance, creditsTotal }, pagination }
  //
  // Date selection per source:
  //   quotes    â†’ createdAt
  //   orders    â†’ createdAt
  //   invoices  â†’ issueDate  (canonical document date, NOT createdAt)
  //   payments  â†’ paidAt ?? succeededAt ?? appliedAt ?? createdAt
  //   refunds   â†’ refundedAt ?? createdAt
  //   credits   â†’ createdAt
  //
  // Sort stability: primary = date desc/asc, secondary = id asc (deterministic tiebreaker)
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

      // â”€â”€ Parse & normalise filters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

      const rawDateFrom = (req.query.dateFrom as string) || null;
      const rawDateTo   = (req.query.dateTo   as string) || null;

      // Ensure dateTo is end-of-day when a date-only string (10 chars) is given,
      // so that records from that calendar day are included.
      const dateFrom = rawDateFrom || null;
      const dateTo   = rawDateTo
        ? rawDateTo.length === 10
          ? `${rawDateTo}T23:59:59.999Z`
          : rawDateTo
        : null;

      const search    = ((req.query.search as string) || "").toLowerCase().trim();
      const typeFilter: string[] | null = req.query.type
        ? (req.query.type as string).split(",").map((t) => t.trim()).filter(Boolean)
        : null;
      const sort      = req.query.sort === "asc" ? "asc" : "desc";
      const page      = Math.max(1, parseInt((req.query.page     as string) || "1",  10));
      const pageSize  = Math.min(100, Math.max(1, parseInt((req.query.pageSize as string) || "50", 10)));

      // â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

      // Canonical transaction type enum used throughout this endpoint.
      // credit-transaction table values are remapped:
      //   "payment"    â†’ "credit"      (manual credit applied to account)
      //   "charge"     â†’ "charge"      (debit/charge added to account)
      //   "adjustment" â†’ "adjustment"  (balance correction)
      type TxType = "quote" | "order" | "invoice" | "payment" | "refund" | "credit" | "adjustment" | "charge";

      type TxRow = {
        id: string;
        date: string;           // ISO 8601 UTC
        type: TxType;
        referenceNumber: string;
        description: string;
        status: string;
        amount: string;         // always positive absolute value
        balanceImpact: string | null;  // negative = reduces balance; positive = increases balance
        method: string | null;
        linkType: "quote" | "order" | "invoice" | null;
        linkId: string | null;
      };

      // â”€â”€ Date helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

      /** Convert any Date | string | null/undefined to a safe ISO string. */
      const safeIso = (val: Date | string | null | undefined): string => {
        if (val == null) return "1970-01-01T00:00:00.000Z";
        const d = new Date(val as any);
        return isNaN(d.getTime()) ? "1970-01-01T00:00:00.000Z" : d.toISOString();
      };

      /** Choose the best available semantic date for a payment row. */
      const paymentEffectiveDate = (row: {
        paidAt: Date | null;
        succeededAt: Date | null;
        appliedAt: Date;
        createdAt: Date;
      }): string => {
        return safeIso(row.paidAt ?? row.succeededAt ?? row.appliedAt ?? row.createdAt);
      };

      const rows: TxRow[] = [];

      // â”€â”€ Fetch credit transactions once (no orgId column â€” validate via customer check above) â”€â”€
      const allCreditTx = await storage.getCustomerCreditTransactions(customerId);

      // â”€â”€ QUOTES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (!typeFilter || typeFilter.includes("quote")) {
        const dateFilters: SQL<unknown>[] = [];
        if (dateFrom) dateFilters.push(sql`${quotes.createdAt} >= ${dateFrom}`);
        if (dateTo)   dateFilters.push(sql`${quotes.createdAt} <= ${dateTo}`);

        const quoteRows = await db
          .select({
            id: quotes.id,
            createdAt: quotes.createdAt,
            quoteNumber: quotes.quoteNumber,
            displayNumber: quotes.displayNumber,
            numberCore: quotes.numberCore,
            label: quotes.label,
            status: quotes.status,
            totalPrice: quotes.totalPrice,
          })
          .from(quotes)
          .where(and(eq(quotes.organizationId, organizationId), eq(quotes.customerId, customerId), ...dateFilters));

        for (const q of quoteRows) {
          const refNum = resolveDocumentDisplayNumber({
            displayNumber: q.displayNumber,
            numberCore: q.numberCore,
            legacyNumber: q.quoteNumber,
          }) || "—";
          const descText = q.label || "Quote";
          if (search) {
            const s = search;
            if (!refNum.toLowerCase().includes(s) && !descText.toLowerCase().includes(s)) continue;
          }
          rows.push({
            id: `quote-${q.id}`,
            date: safeIso(q.createdAt),
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

      // â”€â”€ ORDERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (!typeFilter || typeFilter.includes("order")) {
        const dateFilters: SQL<unknown>[] = [];
        if (dateFrom) dateFilters.push(sql`${orders.createdAt} >= ${dateFrom}`);
        if (dateTo)   dateFilters.push(sql`${orders.createdAt} <= ${dateTo}`);

        const orderRows = await db
          .select({
            id: orders.id,
            createdAt: orders.createdAt,   // string (mode:"string")
            orderNumber: orders.orderNumber,
            displayNumber: orders.displayNumber,
            numberCore: orders.numberCore,
            poNumber: orders.poNumber,
            label: orders.label,
            status: orders.status,
            total: orders.total,
          })
          .from(orders)
          .where(and(eq(orders.organizationId, organizationId), eq(orders.customerId, customerId), ...dateFilters));

        for (const o of orderRows) {
          const refNum = resolveDocumentDisplayNumber({
            displayNumber: o.displayNumber,
            numberCore: o.numberCore,
            legacyNumber: o.orderNumber,
          }) || "—";
          const descText = o.label || "Order";
          if (search) {
            const s = search;
            const poNum = (o.poNumber || "").toLowerCase();
            if (
              !refNum.toLowerCase().includes(s) &&
              !descText.toLowerCase().includes(s) &&
              !poNum.includes(s)
            ) continue;
          }
          rows.push({
            id: `order-${o.id}`,
            date: safeIso(o.createdAt),
            type: "order",
            referenceNumber: refNum,
            description: o.poNumber ? `${descText} (PO: ${o.poNumber})` : descText,
            status: o.status || "new",
            amount: o.total || "0",
            balanceImpact: null,
            method: null,
            linkType: "order",
            linkId: o.id,
          });
        }
      }

      // â”€â”€ INVOICES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Uses issueDate (document date) not createdAt for chronological accuracy.
      if (!typeFilter || typeFilter.includes("invoice")) {
        const dateFilters: SQL<unknown>[] = [];
        if (dateFrom) dateFilters.push(sql`${invoices.issueDate} >= ${dateFrom}`);
        if (dateTo)   dateFilters.push(sql`${invoices.issueDate} <= ${dateTo}`);

        const invoiceRows = await db
          .select({
            id: invoices.id,
            issueDate: invoices.issueDate,
            invoiceNumber: invoices.invoiceNumber,
            displayNumber: invoices.displayNumber,
            numberCore: invoices.numberCore,
            customerPoNumber: invoices.customerPoNumber,
            status: invoices.status,
            total: invoices.total,
            balanceDue: invoices.balanceDue,
            notesPublic: invoices.notesPublic,
          })
          .from(invoices)
          .where(and(eq(invoices.organizationId, organizationId), eq(invoices.customerId, customerId), ...dateFilters));

        for (const inv of invoiceRows) {
          const refNum = resolveDocumentDisplayNumber({
            displayNumber: inv.displayNumber,
            numberCore: inv.numberCore,
            legacyNumber: inv.invoiceNumber,
          }) || "—";
          const poNum    = (inv.customerPoNumber || "").toLowerCase();
          const descText = inv.notesPublic || (inv.customerPoNumber ? `Invoice (PO: ${inv.customerPoNumber})` : "Invoice");
          if (search) {
            const s = search;
            if (
              !refNum.toLowerCase().includes(s) &&
              !descText.toLowerCase().includes(s) &&
              !poNum.includes(s)
            ) continue;
          }
          rows.push({
            id: `invoice-${inv.id}`,
            date: safeIso(inv.issueDate),
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

      // â”€â”€ PAYMENTS & REFUNDS (via invoice join for customerId scope) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Payments: status = succeeded  â†’ type "payment"
      // Refunds:  status = refunded   â†’ type "refund"
      // Other statuses (pending/failed/canceled) are surfaced only when explicitly filtered.
      const wantPayment = !typeFilter || typeFilter.includes("payment");
      const wantRefund  = !typeFilter || typeFilter.includes("refund");

      if (wantPayment || wantRefund) {
        // Fetch all non-void non-failed payments; filter by type in loop.
        // Date filter uses the effective payment date column (appliedAt as fallback for SQL).
        const dateFilters: SQL<unknown>[] = [];
        if (dateFrom) dateFilters.push(sql`COALESCE(${payments.paidAt}, ${payments.succeededAt}, ${payments.appliedAt}, ${payments.createdAt}) >= ${dateFrom}`);
        if (dateTo)   dateFilters.push(sql`COALESCE(${payments.paidAt}, ${payments.succeededAt}, ${payments.appliedAt}, ${payments.createdAt}) <= ${dateTo}`);

        const paymentRows = await db
          .select({
            id: payments.id,
            paidAt: payments.paidAt,
            succeededAt: payments.succeededAt,
            appliedAt: payments.appliedAt,
            refundedAt: payments.refundedAt,
            createdAt: payments.createdAt,
            amount: payments.amount,
            status: payments.status,
            method: payments.method,
            notes: payments.notes,
            note: payments.note,
            invoiceId: payments.invoiceId,
            invoiceNumber: invoices.invoiceNumber,
            invoiceDisplayNumber: invoices.displayNumber,
            invoiceNumberCore: invoices.numberCore,
          })
          .from(payments)
          .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
          .where(
            and(
              eq(payments.organizationId, organizationId),
              eq(invoices.customerId, customerId),
              // Only include terminal statuses â€” exclude pending/failed/canceled
              sql`${payments.status} IN ('succeeded', 'refunded')`,
              ...dateFilters,
            ),
          );

        for (const p of paymentRows) {
          const isRefund   = p.status === "refunded";
          const txType: TxType = isRefund ? "refund" : "payment";

          if (isRefund  && !wantRefund)  continue;
          if (!isRefund && !wantPayment) continue;

          const invoiceDisplayNumber = resolveDocumentDisplayNumber({
            displayNumber: p.invoiceDisplayNumber,
            numberCore: p.invoiceNumberCore,
            legacyNumber: p.invoiceNumber,
          });
          const refNum   = invoiceDisplayNumber ? `PMT-${invoiceDisplayNumber}` : "PMT";
          const noteText = p.notes || p.note || "";
          const descText = noteText || `${isRefund ? "Refund" : "Payment"} â€” ${p.method || "other"}`;

          if (search) {
            const s = search;
            if (!refNum.toLowerCase().includes(s) && !descText.toLowerCase().includes(s)) continue;
          }

          const amt   = p.amount || "0";
          const txDate = isRefund
            ? safeIso(p.refundedAt ?? p.createdAt)
            : paymentEffectiveDate({ paidAt: p.paidAt, succeededAt: p.succeededAt, appliedAt: p.appliedAt!, createdAt: p.createdAt! });

          rows.push({
            id: `${txType}-${p.id}`,
            date: txDate,
            type: txType,
            referenceNumber: refNum,
            description: descText,
            status: p.status,
            amount: amt,
            // Payments reduce balance; refunds increase it
            balanceImpact: isRefund ? amt : `-${amt}`,
            method: p.method || null,
            linkType: "invoice",
            linkId: p.invoiceId,
          });
        }
      }

      // â”€â”€ CREDIT / ADJUSTMENT / CHARGE TRANSACTIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Remap transactionType values to canonical TxType:
      //   "payment"    â†’ "credit"       (manual credit applied to customer account)
      //   "charge"     â†’ "charge"
      //   "adjustment" â†’ "adjustment"
      const creditTypeWanted = !typeFilter || typeFilter.some((t) =>
        ["credit", "adjustment", "charge"].includes(t)
      );

      if (creditTypeWanted) {
        for (const ct of allCreditTx) {
          // Remap type to canonical enum
          const rawType = ct.transactionType || "adjustment";
          const txType: TxType =
            rawType === "payment"    ? "credit"     :
            rawType === "charge"     ? "charge"     :
            rawType === "adjustment" ? "adjustment" :
            "adjustment";

          // Apply type filter
          if (typeFilter && !typeFilter.includes(txType)) continue;

          // In-memory date filter (no orgId column on this table)
          const ctDate = new Date(ct.createdAt as any);
          if (dateFrom && ctDate < new Date(dateFrom)) continue;
          if (dateTo   && ctDate > new Date(dateTo))   continue;

          const refNum   = ct.referenceNumber || "â€”";
          const descText = ct.description || rawType;

          if (search) {
            const s = search;
            if (!refNum.toLowerCase().includes(s) && !descText.toLowerCase().includes(s)) continue;
          }

          rows.push({
            id: `credit-${ct.id}`,
            date: safeIso(ct.createdAt),
            type: txType,
            referenceNumber: refNum,
            description: descText,
            status: "applied",
            // credits/adjustments reduce balance; charges increase it
            amount: Math.abs(parseFloat(ct.amount || "0")).toFixed(2),
            balanceImpact: txType === "charge" ? ct.amount || "0" : `-${Math.abs(parseFloat(ct.amount || "0")).toFixed(2)}`,
            method: null,
            linkType: null,
            linkId: null,
          });
        }
      }

      // â”€â”€ Sort: primary = date, secondary = id (stable tiebreaker) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      rows.sort((a, b) => {
        const timeDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
        if (timeDiff !== 0) return sort === "desc" ? -timeDiff : timeDiff;
        // Stable tiebreaker: lexicographic id comparison
        return sort === "desc"
          ? b.id.localeCompare(a.id)
          : a.id.localeCompare(b.id);
      });

      // â”€â”€ SUMMARY TOTALS (always from full unfiltered dataset) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const allInvoicesForSummary = await db
        .select({ total: invoices.total, balanceDue: invoices.balanceDue, status: invoices.status })
        .from(invoices)
        .where(and(eq(invoices.organizationId, organizationId), eq(invoices.customerId, customerId)));

      const allPaymentsForSummary = await db
        .select({ amount: payments.amount, status: payments.status })
        .from(payments)
        .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
        .where(
          and(
            eq(payments.organizationId, organizationId),
            eq(invoices.customerId, customerId),
            sql`${payments.status} IN ('succeeded', 'refunded')`,
          ),
        );

      // invoicedTotal: exclude void invoices (they were cancelled â€” don't count as revenue)
      const invoicedTotal = allInvoicesForSummary
        .filter((inv) => inv.status !== "void")
        .reduce((s, inv) => s + parseFloat(inv.total || "0"), 0);

      const paidTotal = allPaymentsForSummary
        .filter((p) => p.status === "succeeded")
        .reduce((s, p) => s + parseFloat(p.amount || "0"), 0);

      const refundedTotal = allPaymentsForSummary
        .filter((p) => p.status === "refunded")
        .reduce((s, p) => s + parseFloat(p.amount || "0"), 0);

      // openBalance: sum of balanceDue on non-void, non-paid invoices
      const openBalance = allInvoicesForSummary.reduce((s, inv) => {
        if (inv.status === "paid" || inv.status === "void") return s;
        return s + parseFloat(inv.balanceDue || "0");
      }, 0);

      // creditsTotal: sum of credits/adjustments from credit transaction table
      const creditsTotal = allCreditTx
        .filter((ct) => ct.transactionType === "payment" || ct.transactionType === "credit")
        .reduce((s, ct) => s + parseFloat(ct.amount || "0"), 0);

      // â”€â”€ Paginate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const total        = rows.length;
      const totalPages   = Math.max(1, Math.ceil(total / pageSize));
      const paginatedRows = rows.slice((page - 1) * pageSize, page * pageSize);

      res.json({
        rows: paginatedRows,
        summary: {
          invoicedTotal:  invoicedTotal.toFixed(2),
          paidTotal:      paidTotal.toFixed(2),
          refundedTotal:  refundedTotal.toFixed(2),
          openBalance:    openBalance.toFixed(2),
          creditsTotal:   creditsTotal.toFixed(2),
        },
        pagination: {
          total,
          page,
          pageSize,
          totalPages,
          hasNextPage:     page < totalPages,
          hasPreviousPage: page > 1,
        },
      });
    } catch (error) {
      console.error("Error fetching customer transactions:", error);
      res.status(500).json({ message: "Failed to fetch customer transactions" });
    }
  });

  // ============================================================
  // CUSTOMER STATEMENT
  // GET /api/customers/:id/statement
  //
  // Query params:
  //   dateFrom        ISO date/datetime (optional, inclusive)
  // ============================================================
  // CUSTOMER ACTIVITY SUMMARY
  // Lightweight aggregate endpoint: open order count, overdue invoice count,
  // last order date, last invoice date, last payment date.
  // Uses 3 cheap aggregate queries against existing tables.
  // ============================================================

  app.get("/api/customers/:id/activity", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const customerId = req.params.id;

      // Verify customer belongs to this org
      const [customerRow] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.organizationId, organizationId), eq(customers.id, customerId)))
        .limit(1);
      if (!customerRow) return res.status(404).json({ message: "Customer not found" });

      // 1. Orders: open count + last order date
      const [orderAgg] = await db
        .select({
          openOrderCount: sql<number>`COUNT(*) FILTER (WHERE ${orders.state} IN ('open','production_complete'))`,
          lastOrderDate:  sql<string | null>`MAX(${orders.createdAt})`,
        })
        .from(orders)
        .where(
          and(
            eq(orders.organizationId, organizationId),
            eq(orders.customerId, customerId),
            sql`${orders.state} != 'canceled'`,
          ),
        );

      // 2. Invoices: overdue count + last invoice date
      const [invoiceAgg] = await db
        .select({
          overdueInvoiceCount: sql<number>`COUNT(*) FILTER (WHERE ${invoices.status} = 'overdue')`,
          lastInvoiceDate:     sql<string | null>`MAX(${invoices.issueDate})`,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.organizationId, organizationId),
            eq(invoices.customerId, customerId),
          ),
        );

      // 3. Payments: last successful payment date
      const [paymentAgg] = await db
        .select({
          lastPaymentDate: sql<string | null>`MAX(COALESCE(${payments.paidAt}, ${payments.appliedAt}))`,
        })
        .from(payments)
        .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
        .where(
          and(
            eq(payments.organizationId, organizationId),
            eq(invoices.customerId, customerId),
            sql`${payments.status} != 'refunded'`,
          ),
        );

      const [latestPortalProfileUpdate] = await db
        .select({
          createdAt: auditLogs.createdAt,
          userName: auditLogs.userName,
          newValues: auditLogs.newValues,
        })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, organizationId),
            eq(auditLogs.entityType, "customer"),
            eq(auditLogs.entityId, customerId),
            eq(auditLogs.actionType, "CUSTOMER_PORTAL_PROFILE_UPDATE"),
          ),
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(1);

      const portalProfileFields = (latestPortalProfileUpdate?.newValues as any)?.fields;

      return res.json({
        openOrderCount:      Number(orderAgg?.openOrderCount   ?? 0),
        lastOrderDate:       orderAgg?.lastOrderDate            ?? null,
        overdueInvoiceCount: Number(invoiceAgg?.overdueInvoiceCount ?? 0),
        lastInvoiceDate:     invoiceAgg?.lastInvoiceDate         ?? null,
        lastPaymentDate:     paymentAgg?.lastPaymentDate          ?? null,
        recentPortalProfileUpdate: latestPortalProfileUpdate
          ? {
              updatedAt: latestPortalProfileUpdate.createdAt,
              updatedBy: latestPortalProfileUpdate.userName ?? null,
              fieldCount: portalProfileFields && typeof portalProfileFields === "object" ? Object.keys(portalProfileFields).length : 0,
            }
          : null,
      });
    } catch (error) {
      console.error("Error fetching customer activity:", error);
      return res.status(500).json({ message: "Failed to fetch customer activity" });
    }
  });

  //   dateTo          ISO date/datetime (optional, inclusive, end-of-day if date-only)
  //   status          "open" | "completed" | "all"  (default: "all")
  //   search          string (optional)
  //   includeInvoices boolean (default: true)
  //   includeQuotes   boolean (default: false)
  //
  // Response sections:
  //   openOrders, completedOrders, invoices, quotes (null when excluded)
  //
  // Rules:
  //   - Org scoping enforced on every query
  //   - Summary totals computed from full unfiltered customer dataset
  //   - Sections reflect applied filters (date, status, search)
  //   - includeInvoices=false â†’ sections.invoices = null
  //   - includeQuotes=false   â†’ sections.quotes = null
  //   - Canceled orders are excluded from all sections
  //   - Void invoices are excluded from invoicedTotal / paidTotal
  //   - Optional date fields (dueDate, closedAt) safely return null when absent
  // ============================================================

  app.get("/api/customers/:id/statement", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const customerId = req.params.id;

      // â”€â”€ Validate customer belongs to this org â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const customer = await storage.getCustomerById(organizationId, customerId);
      if (!customer) return res.status(404).json({ message: "Customer not found" });

      // â”€â”€ Parse filters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const dateFrom      = (req.query.dateFrom as string) || null;
      const dateTo        = normaliseDateTo((req.query.dateTo as string) || null);
      const statusFilter  = (["open", "completed", "all"].includes(req.query.status as string)
        ? (req.query.status as "open" | "completed" | "all")
        : "all");
      const search        = ((req.query.search as string) || "").toLowerCase().trim();
      const includeInvoices = req.query.includeInvoices !== "false";
      const includeQuotes   = req.query.includeQuotes === "true";

      // â”€â”€ Customer identity block â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const primaryContact = ((customer as any).contacts || [])
        .find((c: any) => c.isPrimary) || null;

      const billingAddress = (
        customer.billingStreet1 ||
        customer.billingCity   ||
        customer.billingState
      ) ? {
        street1:    customer.billingStreet1    || null,
        street2:    customer.billingStreet2    || null,
        city:       customer.billingCity       || null,
        state:      customer.billingState      || null,
        postalCode: customer.billingPostalCode || null,
        country:    customer.billingCountry    || null,
      } : null;

      const shippingAddress = (
        customer.shippingStreet1 ||
        customer.shippingCity    ||
        customer.shippingState
      ) ? {
        street1:    customer.shippingStreet1    || null,
        street2:    customer.shippingStreet2    || null,
        city:       customer.shippingCity       || null,
        state:      customer.shippingState      || null,
        postalCode: customer.shippingPostalCode || null,
        country:    customer.shippingCountry    || null,
      } : null;

      const customerIdentity = {
        customerId:     customer.id,
        companyName:    customer.companyName,
        primaryContact: primaryContact ? {
          firstName: primaryContact.firstName,
          lastName:  primaryContact.lastName,
          email:     primaryContact.email  || null,
          phone:     primaryContact.phone  || null,
        } : null,
        email:           customer.email   || null,
        phone:           customer.phone   || null,
        billingAddress,
        shippingAddress,
      };

      // â”€â”€ FETCH: all non-canceled orders (one query) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const allOrderRows = await db
        .select({
          id:          orders.id,
          orderNumber: orders.orderNumber,
          displayNumber: orders.displayNumber,
          numberCore: orders.numberCore,
          poNumber:    orders.poNumber,
          label:       orders.label,
          status:      orders.status,
          state:       orders.state,
          dueDate:     orders.dueDate,
          closedAt:    orders.closedAt,
          shippedAt:   orders.shippedAt,
          total:       orders.total,
          createdAt:   orders.createdAt,
        })
        .from(orders)
        .where(
          and(
            eq(orders.organizationId, organizationId),
            eq(orders.customerId, customerId),
            sql`${orders.state} != 'canceled'`,
          ),
        );

      // â”€â”€ FETCH: all invoices for this customer (one query) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const allInvoiceRows = includeInvoices ? await db
        .select({
          id:                invoices.id,
          invoiceNumber:     invoices.invoiceNumber,
          displayNumber:     invoices.displayNumber,
          numberCore:        invoices.numberCore,
          orderId:           invoices.orderId,
          sourceOrderNumber: invoices.sourceOrderNumber,
          issueDate:         invoices.issueDate,
          dueDate:           invoices.dueDate,
          status:            invoices.status,
          total:             invoices.total,
          amountPaid:        invoices.amountPaid,
          balanceDue:        invoices.balanceDue,
          customerPoNumber:  invoices.customerPoNumber,
          notesPublic:       invoices.notesPublic,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.organizationId, organizationId),
            eq(invoices.customerId, customerId),
          ),
        ) : [];

      // â”€â”€ FETCH: quotes (one query, only when requested) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const allQuoteRows = includeQuotes ? await db
        .select({
          id:          quotes.id,
          quoteNumber: quotes.quoteNumber,
          displayNumber: quotes.displayNumber,
          numberCore: quotes.numberCore,
          label:       quotes.label,
          status:      quotes.status,
          totalPrice:  quotes.totalPrice,
          createdAt:   quotes.createdAt,
        })
        .from(quotes)
        .where(
          and(
            eq(quotes.organizationId, organizationId),
            eq(quotes.customerId, customerId),
          ),
        ) : [];

      // â”€â”€ FETCH: credit transactions once (reuse for summary) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const allCreditTx = await storage.getCustomerCreditTransactions(customerId);

      // â”€â”€ FETCH: refund total from payments (single aggregate) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const [refundRow] = await db
        .select({ total: sql<string>`COALESCE(SUM(${payments.amount}::numeric),'0')` })
        .from(payments)
        .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
        .where(
          and(
            eq(payments.organizationId, organizationId),
            eq(invoices.customerId, customerId),
            eq(payments.status, "refunded"),
          ),
        );
      const refundTotal = parseFloat(refundRow?.total || "0");

      // â”€â”€ Build invoice lookup map (orderId â†’ best invoice summary) â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Used to annotate order rows with invoice status without N+1 queries.
      // If an order has multiple invoices, prefer non-draft / non-void, most recent by issueDate.
      const invoiceByOrderId = new Map<
        string,
        { status: string; balanceDue: string; invoiceNumber: number; invoiceDisplayNumber: string }
      >();
      if (includeInvoices) {
        // Sort so latest invoice wins (issueDate descending)
        const sorted = [...allInvoiceRows].sort(
          (a, b) => new Date(b.issueDate as any).getTime() - new Date(a.issueDate as any).getTime(),
        );
        for (const inv of sorted) {
          if (!inv.orderId) continue;
          if (inv.status === "void") continue;  // Ignore void invoices for order annotation
          if (!invoiceByOrderId.has(inv.orderId)) {
            invoiceByOrderId.set(inv.orderId, {
              status:        inv.status,
              balanceDue:    inv.balanceDue || "0",
              invoiceNumber: inv.invoiceNumber,
              invoiceDisplayNumber: resolveDocumentDisplayNumber({
                displayNumber: inv.displayNumber,
                numberCore: inv.numberCore,
                legacyNumber: inv.invoiceNumber,
              }),
            });
          }
        }
      }

      // â”€â”€ SECTIONS: filter, classify, map orders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const openOrderSection: any[]      = [];
      const completedOrderSection: any[] = [];

      for (const o of allOrderRows) {
        // Status section filter first
        if (!filterOrderByStatus(o, statusFilter)) continue;

        // Date range filter (uses orderEffectiveDate)
        if (!filterOrderByDate(o, dateFrom, dateTo)) continue;

        // Search filter
        if (!filterOrderBySearch(o, search)) continue;

        const linkedInvoice = invoiceByOrderId.get(o.id) || null;

        const row = {
          orderId:       o.id,
          orderNumber:   o.orderNumber,
          displayNumber:  resolveDocumentDisplayNumber({
            displayNumber: o.displayNumber,
            numberCore: o.numberCore,
            legacyNumber: o.orderNumber,
          }),
          numberCore:     o.numberCore,
          poNumber:      o.poNumber    || null,
          date:          stmtSafeIso(o.createdAt),
          dueDate:       o.dueDate     ? stmtSafeIso(o.dueDate)   : null,
          completedAt:   o.closedAt    ? stmtSafeIso(o.closedAt)  : null,
          shippedAt:     o.shippedAt   ? stmtSafeIso(o.shippedAt) : null,
          status:        o.state,      // canonical state
          legacyStatus:  o.status,     // deprecated status field (for display compat)
          description:   o.label      || null,
          total:         o.total       || "0",
          invoiceStatus: linkedInvoice?.status        || null,
          invoiceNumber: linkedInvoice?.invoiceNumber ?? null,
          invoiceDisplayNumber: linkedInvoice?.invoiceDisplayNumber ?? null,
          balanceDue:    linkedInvoice?.balanceDue    ?? null,
          linkId:        o.id,
        };

        if (isOpenOrder(o.state)) {
          openOrderSection.push(row);
        } else if (isCompletedOrder(o.state)) {
          completedOrderSection.push(row);
        }
        // other non-canceled states (e.g. production_complete is already open)
      }

      // Sort open orders by dueDate asc (soonest first), then createdAt asc
      openOrderSection.sort((a, b) => {
        const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const db_ = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        if (da !== db_) return da - db_;
        return new Date(a.date).getTime() - new Date(b.date).getTime();
      });

      // Sort completed orders by completedAt desc (most recent first)
      completedOrderSection.sort((a, b) => {
        const da = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const db_ = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return db_ - da;
      });

      // â”€â”€ SECTIONS: filter, map invoices â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      let invoiceSection: any[] | null = null;
      if (includeInvoices) {
        invoiceSection = [];
        for (const inv of allInvoiceRows) {
          // Date filter on issueDate
          const invDateMs = new Date(inv.issueDate as any).getTime();
          if (dateFrom && invDateMs < new Date(dateFrom).getTime()) continue;
          if (dateTo   && invDateMs > new Date(dateTo).getTime())   continue;

          // Search filter
          if (!filterInvoiceBySearch(inv, search)) continue;

          invoiceSection.push({
            invoiceId:          inv.id,
            invoiceNumber:      inv.invoiceNumber,
            displayNumber:      resolveDocumentDisplayNumber({
              displayNumber: inv.displayNumber,
              numberCore: inv.numberCore,
              legacyNumber: inv.invoiceNumber,
            }),
            issueDate:          stmtSafeIso(inv.issueDate as any),
            dueDate:            inv.dueDate ? stmtSafeIso(inv.dueDate as any) : null,
            status:             inv.status,
            total:              inv.total     || "0",
            amountPaid:         inv.amountPaid || "0",
            balanceDue:         inv.balanceDue || "0",
            customerPoNumber:   inv.customerPoNumber   || null,
            relatedOrderNumber: inv.sourceOrderNumber  ?? null,
            orderId:            inv.orderId             || null,
            linkId:             inv.id,
          });
        }
        // Sort by issueDate desc
        invoiceSection.sort(
          (a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime(),
        );
      }

      // â”€â”€ SECTIONS: filter, map quotes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      let quoteSection: any[] | null = null;
      if (includeQuotes) {
        quoteSection = [];
        for (const q of allQuoteRows) {
          // Date filter on createdAt
          const qDateMs = new Date(q.createdAt as any).getTime();
          if (dateFrom && qDateMs < new Date(dateFrom).getTime()) continue;
          if (dateTo   && qDateMs > new Date(dateTo).getTime())   continue;

          // Search filter
          if (!filterQuoteBySearch(q, search)) continue;

          quoteSection.push({
            quoteId:     q.id,
            quoteNumber: q.quoteNumber  ?? null,
            displayNumber: resolveDocumentDisplayNumber({
              displayNumber: q.displayNumber,
              numberCore: q.numberCore,
              legacyNumber: q.quoteNumber,
            }),
            createdAt:   stmtSafeIso(q.createdAt as any),
            status:      q.status        || "draft",
            total:       q.totalPrice    || "0",
            description: q.label         || null,
            linkId:      q.id,
          });
        }
        // Sort by createdAt desc
        quoteSection.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
      }

      // â”€â”€ Summary (from FULL unfiltered dataset) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const summary = buildStatementSummary(
        allOrderRows,
        allInvoiceRows,
        allCreditTx,
        refundTotal,
      );

      // â”€â”€ Response â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      res.json({
        customer: customerIdentity,
        filtersEcho: {
          dateFrom,
          dateTo,
          status:          statusFilter,
          search,
          includeInvoices,
          includeQuotes,
        },
        sections: {
          openOrders:      openOrderSection,
          completedOrders: completedOrderSection,
          invoices:        invoiceSection,   // null when includeInvoices=false
          quotes:          quoteSection,     // null when includeQuotes=false
        },
        summary,
      });
    } catch (error) {
      console.error("Error fetching customer statement:", error);
      res.status(500).json({ message: "Failed to fetch customer statement" });
    }
  });

}
