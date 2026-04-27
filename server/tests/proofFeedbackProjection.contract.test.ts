import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { and, eq, sql } from "drizzle-orm";

import { db } from "../db";
import { OrdersRepository } from "../storage/orders.repo";
import { getLatestProofFeedbackByLineItemId } from "../services/proofFeedbackProjectionService";
import {
  customers,
  lineItemProofApprovals,
  lineItemProofVersions,
  orderAttachments,
  organizations,
  products,
  userOrganizations,
  users,
} from "@shared/schema";

const ordersRepo = new OrdersRepository(db);

describe("proof feedback projection contract", () => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const organizationId = `org_proof_projection_${suffix}`;
  const userId = `user_proof_projection_${suffix}`;
  const customerId = `cust_proof_projection_${suffix}`;
  const productId = `prod_proof_projection_${suffix}`;

  let orderId = "";
  let primaryLineItemId = "";
  let siblingLineItemId = "";

  beforeAll(async () => {
    await db.insert(organizations).values({ id: organizationId, name: `Proof Projection ${suffix}`, slug: `proof-projection-${suffix}` });
    await db.insert(users).values({ id: userId, email: `proof-projection-${suffix}@example.com`, role: "admin", isAdmin: true } as any);
    await db.insert(userOrganizations).values({ userId, organizationId, role: "owner", isDefault: true });
    await db.insert(customers).values({ id: customerId, organizationId, companyName: "Proof Projection Customer", status: "active" } as any);
    await db.insert(products).values({
      id: productId,
      organizationId,
      name: "Proof Projection Product",
      description: "test product",
      pricingProfileKey: "default",
      pricingFormula: "1",
      pricingMode: "flat",
      isTaxable: true,
      isActive: true,
    } as any);

    const createdOrder = await ordersRepo.createOrder(organizationId, {
      customerId,
      createdByUserId: userId,
      lineItems: [
        {
          productId,
          productType: "wide_roll",
          description: "Proof Projection Item A",
          width: 12,
          height: 18,
          quantity: 1,
          unitPrice: 20,
          totalPrice: 20,
          status: "new",
          requiresDesign: true,
          requiresProofApproval: true,
          requiresPrepress: true,
          selectedOptions: [],
        },
        {
          productId,
          productType: "wide_roll",
          description: "Proof Projection Item B",
          width: 8,
          height: 10,
          quantity: 1,
          unitPrice: 12,
          totalPrice: 12,
          status: "new",
          requiresDesign: true,
          requiresProofApproval: true,
          requiresPrepress: true,
          selectedOptions: [],
        },
      ],
    } as any);

    orderId = createdOrder.id;
    primaryLineItemId = createdOrder.lineItems[0].id;
    siblingLineItemId = createdOrder.lineItems[1].id;
  });

  afterAll(async () => {
    await db.execute(sql`delete from line_item_proof_approvals where organization_id = ${organizationId}`);
    await db.execute(sql`delete from line_item_proof_versions where organization_id = ${organizationId}`);
    await db.execute(sql`delete from order_attachments where order_id = ${orderId}`);
    await db.execute(sql`delete from order_line_items where order_id = ${orderId}`);
    await db.execute(sql`delete from orders where id = ${orderId}`);
    await db.delete(products).where(eq(products.id, productId));
    await db.delete(customers).where(eq(customers.id, customerId));
    await db.delete(userOrganizations).where(and(eq(userOrganizations.userId, userId), eq(userOrganizations.organizationId, organizationId)));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(organizations).where(eq(organizations.id, organizationId));
  });

  async function createProofFixture(args: {
    lineItemId: string;
    name: string;
    versionNumber: number;
    decision?: "approved" | "rejected" | "revision_requested";
    responseNotes?: string | null;
    respondedAt?: string;
    responderSource?: string;
  }) {
    const attachmentId = `proof_attachment_${args.name}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const versionId = `proof_version_${args.name}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    await db.insert(orderAttachments).values({
      id: attachmentId,
      orderId,
      orderLineItemId: args.lineItemId,
      uploadedByUserId: userId,
      uploadedByName: "Proof Projection User",
      fileName: `${args.name}.pdf`,
      fileUrl: `https://example.com/${args.name}.pdf`,
      role: "proof",
    } as any);

    await db.insert(lineItemProofVersions).values({
      id: versionId,
      organizationId,
      orderId,
      lineItemId: args.lineItemId,
      proofFileId: attachmentId,
      versionNumber: args.versionNumber,
      status: args.decision ? args.decision : "awaiting_response",
      createdByUserId: userId,
      updatedAt: new Date(args.respondedAt ?? Date.now()),
      sentAt: new Date(args.respondedAt ?? Date.now()),
      sentByUserId: userId,
    } as any);

    if (!args.decision) {
      return { versionId };
    }

    const approvalId = `proof_approval_${args.name}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    await db.insert(lineItemProofApprovals).values({
      id: approvalId,
      organizationId,
      orderId,
      lineItemId: args.lineItemId,
      proofVersionId: versionId,
      decision: args.decision,
      responseNotes: args.responseNotes ?? null,
      responderUserId: args.responderSource === "customer" ? null : userId,
      responderName: args.responderSource === "customer" ? "Customer Contact" : "Proof Projection User",
      responderEmail: args.responderSource === "customer" ? "customer@example.com" : `proof-projection-${suffix}@example.com`,
      responderSource: args.responderSource ?? "internal",
      respondedAt: new Date(args.respondedAt ?? Date.now()),
    } as any);

    return { versionId, approvalId };
  }

  test("returns null when a line item has no proof feedback", async () => {
    const result = await getLatestProofFeedbackByLineItemId({ organizationId, lineItemId: primaryLineItemId });
    expect(result).toBeNull();
  });

  test("returns the latest proof feedback for the same line item only", async () => {
    await createProofFixture({
      lineItemId: siblingLineItemId,
      name: "sibling-latest",
      versionNumber: 1,
      decision: "rejected",
      responseNotes: "Sibling line item feedback",
      respondedAt: "2026-03-20T12:00:00.000Z",
      responderSource: "customer",
    });

    await createProofFixture({
      lineItemId: primaryLineItemId,
      name: "primary-old",
      versionNumber: 1,
      decision: "revision_requested",
      responseNotes: "Please update the crop marks and alignment for the final review.",
      respondedAt: "2026-03-20T10:00:00.000Z",
      responderSource: "customer",
    });

    await createProofFixture({
      lineItemId: primaryLineItemId,
      name: "primary-new",
      versionNumber: 2,
      decision: "approved",
      responseNotes: "Approved after final copy adjustment.",
      respondedAt: "2026-03-20T13:00:00.000Z",
      responderSource: "customer",
    });

    const result = await getLatestProofFeedbackByLineItemId({ organizationId, lineItemId: primaryLineItemId });
    expect(result).not.toBeNull();
    expect(result?.decision).toBe("approved");
    expect(result?.responseNotes).toBe("Approved after final copy adjustment.");
    expect(result?.versionNumber).toBe(2);
    expect(result?.responderName).toBe("Customer Contact");
    expect(result?.responderRole).toBe("customer");
    expect(result?.respondedAt).toBe("2026-03-20T13:00:00.000Z");
    expect(result?.responseSnippet).toContain("Approved after final copy adjustment.");
  });

  test("keeps the latest decision context when notes are blank", async () => {
    await createProofFixture({
      lineItemId: primaryLineItemId,
      name: "primary-blank-notes",
      versionNumber: 3,
      decision: "revision_requested",
      responseNotes: "   ",
      respondedAt: "2026-03-20T14:00:00.000Z",
      responderSource: "internal",
    });

    const result = await getLatestProofFeedbackByLineItemId({ organizationId, lineItemId: primaryLineItemId });
    expect(result?.decision).toBe("revision_requested");
    expect(result?.responseNotes).toBeNull();
    expect(result?.responseSnippet).toBe("Revision Requested without written feedback.");
    expect(result?.responderRole).toBe("admin");
  });
});