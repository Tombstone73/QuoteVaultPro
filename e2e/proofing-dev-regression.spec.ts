import { expect, test, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";

import { db } from "../server/db";
import {
  createLineItemProofVersion,
  markProofVersionSent,
  resolveLineItemProofingTruth,
} from "../server/services/proofingService";
import {
  customers,
  lineItemProofApprovals,
  lineItemProofManualApprovalOverrides,
  lineItemProofVersions,
  orderAttachments,
  orderLineItems,
  orders,
  productVariants,
  products,
  users,
} from "../shared/schema";

const ORG_ID = "org_titan_001";
const BASE_URL = requireEnv("PLAYWRIGHT_BASE_URL");
const EMAIL = requireEnv("PLAYWRIGHT_EMAIL");
const SAME_ORIGIN_API_PREFIX = `${new URL(BASE_URL).origin}/api/`;

type FixtureLine = {
  id: string;
  label: string;
  attachmentId?: string;
  proofVersionId?: string;
};

type Fixture = {
  orderId: string;
  createAndSend: FixtureLine;
  approve: FixtureLine;
  reject: FixtureLine;
  revision: FixtureLine;
  override: FixtureLine;
};

type FreshOrderFixture = {
  orderId: string;
  orderNumber: string;
  lineItemId: string;
  lineItemLabel: string;
  productName: string;
};

test.describe.serial("staff proofing DEV regression", () => {
  test("fresh proof-required order stays in proofing until approval", async ({ page }) => {
    test.setTimeout(300_000);

    await test.step("shared auth state yields a same-origin browser session", async () => {
      await page.goto(urlFor("/dashboard"), { waitUntil: "domcontentloaded" });
      await expect(page).not.toHaveURL(/\/login/);

      const sessionState = await browserSameOriginApi(page, "/api/auth/session");
      expect(sessionState.status).toBe(200);
      expect(sessionState.json?.authenticated).toBe(true);
    });

    const fresh = await createFreshProofRequiredOrder(page);

    await test.step("fresh order persists proof-required workflow truth", async () => {
      const truth = await getTruth(fresh.lineItemId);
      expect(truth.requiresProofApproval).toBe(true);
      expect(truth.workflowState).toBe("awaiting_proof_approval");
    });

    await test.step("proofing queue projects the fresh line item", async () => {
      await expect
        .poll(async () => {
          const row = await getProofingQueueRow(page, fresh.lineItemId);
          return row?.workflowState ?? null;
        }, { timeout: 30_000 })
        .toBe("awaiting_proof_approval");

      const row = await getProofingQueueRow(page, fresh.lineItemId);
      expect(row?.requiresProofApproval).toBe(true);
      expect(row?.lineItemLabel).toBe(fresh.lineItemLabel);
    });

    await test.step("proofing UI shows the item and enables New Proof after explicit selection", async () => {
      await page.goto(urlFor("/production/proofing"), { waitUntil: "domcontentloaded" });
      await waitForProofingShell(page);

      await clickSlice(page, "All");
      await clickQueueRow(page, fresh.lineItemLabel);
      await expectBodyText(page, fresh.lineItemLabel);

      const newProofButton = getNewProofButton(page);
      await expect(newProofButton).toBeEnabled();
    });

    await test.step("proof-required bypass to production remains blocked", async () => {
      const transitionAttempt = await browserSameOriginApi(
        page,
        `/api/line-items/${fresh.lineItemId}/workflow-transition`,
        "POST",
        {
          toState: "ready_for_prepress",
        },
      );

      expect(transitionAttempt.ok).toBe(false);
      expect(transitionAttempt.status).toBeGreaterThanOrEqual(400);
      expect(transitionAttempt.status).toBeLessThan(500);
      expect(String(transitionAttempt.json?.error || transitionAttempt.json?.message || "")).toMatch(
        /Approved proof is required|not allowed|No active production owner/i,
      );

      const truth = await getTruth(fresh.lineItemId);
      expect(truth.workflowState).toBe("awaiting_proof_approval");

      const proofingRow = await getProofingQueueRow(page, fresh.lineItemId);
      expect(proofingRow?.workflowState).toBe("awaiting_proof_approval");

      const prepressQueue = await page.request.get("/api/prepress/queue");
      expect(prepressQueue.ok()).toBe(true);
      const prepressBody = await prepressQueue.json();
      const prepressItems: any[] = prepressBody?.data ?? [];
      expect(prepressItems.some((item) => String(item.jobNumber || "") === String(fresh.orderNumber))).toBe(false);
    });
  });

  test("same-origin proofing workflow stays operational", async ({ page }) => {
    test.setTimeout(300_000);

    const requestUrls = new Set<string>();
    page.on("request", (request) => {
      requestUrls.add(request.url());
    });

    const fixture = await seedFixture();

    try {
      await test.step("shared auth state yields a same-origin browser session", async () => {
        await page.goto(urlFor("/dashboard"), { waitUntil: "domcontentloaded" });
        await expect(page).not.toHaveURL(/\/login/);

        const sessionState = await browserSameOriginApi(page, "/api/auth/session");
        expect(sessionState.status).toBe(200);
        expect(sessionState.json?.authenticated).toBe(true);
      });

      await test.step("proofing page loads queue and detail on live backend truth", async () => {
        await page.goto(urlFor("/production/proofing"), { waitUntil: "domcontentloaded" });
        await waitForProofingShell(page);

        await clickSlice(page, "All");
        await clickQueueRow(page, fixture.createAndSend.label);
        await expectBodyText(page, fixture.createAndSend.label);
      });

      await test.step("existing proof file creates a new draft version", async () => {
        const filesRequestsBefore = filterRequests(
          requestUrls,
          `/api/orders/${fixture.orderId}/line-items/${fixture.createAndSend.id}/files`,
        );

        const newProofButton = getNewProofButton(page);
        await expect(newProofButton).toBeEnabled();
        await newProofButton.click();
        await page.getByRole("heading", { name: /Create Proof Version/i }).waitFor({ state: "visible", timeout: 30_000 });

        const existingProofButton = page.locator("button").filter({ hasText: "seed-existing-proof.pdf" }).first();
        await expect(existingProofButton).toBeVisible();
        await existingProofButton.click();

        await page.getByRole("button", { name: /create draft version/i }).click();
        await waitForProofingShell(page);

        const truth = await getTruth(fixture.createAndSend.id);
        expect(truth.proofVersionHistory.length).toBe(1);
        expect(truth.currentActionableProofVersion?.status).toBe("draft");

        const filesRequestsAfter = filterRequests(
          requestUrls,
          `/api/orders/${fixture.orderId}/line-items/${fixture.createAndSend.id}/files`,
        );
        expect(filesRequestsAfter.length).toBeGreaterThanOrEqual(filesRequestsBefore.length);
        expect(filesRequestsAfter.every((url) => url.startsWith(SAME_ORIGIN_API_PREFIX))).toBe(true);
      });

      await test.step("uploading a proof file creates the next draft version", async () => {
        const newProofButton = getNewProofButton(page);
        await expect(newProofButton).toBeEnabled();
        await newProofButton.click();
        await page.getByRole("heading", { name: /Create Proof Version/i }).waitFor({ state: "visible", timeout: 30_000 });

        await page.locator("#proof-upload-file").setInputFiles({
          name: "uploaded-proof-v2.pdf",
          mimeType: "application/pdf",
          buffer: buildPdf("uploaded-proof-v2"),
        });

        await page.getByRole("button", { name: /create draft version/i }).click();
        await waitForProofingShell(page);

        const truth = await getTruth(fixture.createAndSend.id);
        expect(truth.proofVersionHistory.length).toBe(2);
        expect(truth.currentActionableProofVersion?.status).toBe("draft");
        expect(truth.currentActionableProofVersion?.proofFileId).not.toBe(fixture.createAndSend.attachmentId);
      });

      await test.step("send, approve, reject, and revision actions follow canonical workflow truth", async () => {
        await clickSlice(page, "Awaiting Send");
        await clickQueueRow(page, fixture.createAndSend.label);
        await page.getByRole("button", { name: /upload & send v\d+ proof|send selected draft for review/i }).click();
        await page.getByRole("heading", { name: /Send Proof for Review/i }).waitFor({ state: "visible", timeout: 30_000 });
        await page.locator("#proof-send-name").fill("DEV Regression");
        await page.locator("#proof-send-email").fill("dev-regression@example.com");
        await page.locator("#proof-customer-message").fill("Regression smoke send");
        await page.getByRole("button", { name: /send proof|send draft version/i }).click();
        await waitForProofingShell(page);

        let truth = await getTruth(fixture.createAndSend.id);
        expect(truth.currentActionableProofVersion?.status).toBe("awaiting_response");

        await clickSlice(page, "Awaiting Approval");

        await clickQueueRow(page, fixture.approve.label);
        let response = await browserSameOriginApi(
          page,
          `/api/proofing/versions/${fixture.approve.proofVersionId}/respond`,
          "POST",
          {
            decision: "approved",
            responseNotes: "Approved in regression test",
            responderSource: "staff_proofing_dev_regression",
          },
        );
        expect(response.status).toBe(200);
        truth = await getTruth(fixture.approve.id);
        expect(truth.approvedNormally).toBe(true);
        expect(truth.approvedProofSource).toBe("normal");

        await page.reload({ waitUntil: "domcontentloaded" });
        await waitForProofingShell(page);
        await clickQueueRow(page, fixture.reject.label);
        response = await browserSameOriginApi(
          page,
          `/api/proofing/versions/${fixture.reject.proofVersionId}/respond`,
          "POST",
          {
            decision: "rejected",
            responseNotes: "Rejected in regression test",
            responderSource: "staff_proofing_dev_regression",
          },
        );
        expect(response.status).toBe(200);
        truth = await getTruth(fixture.reject.id);
        expect(truth.workflowState).toBe("needs_design");
        expect(truth.proofDecisionHistory[0]?.decision).toBe("rejected");

        await page.reload({ waitUntil: "domcontentloaded" });
        await waitForProofingShell(page);
        await clickQueueRow(page, fixture.revision.label);
        response = await browserSameOriginApi(
          page,
          `/api/proofing/versions/${fixture.revision.proofVersionId}/respond`,
          "POST",
          {
            decision: "revision_requested",
            responseNotes: "Revision requested in regression test",
            responderSource: "staff_proofing_dev_regression",
          },
        );
        expect(response.status).toBe(200);
        truth = await getTruth(fixture.revision.id);
        expect(truth.workflowState).toBe("needs_design");
        expect(truth.proofDecisionHistory[0]?.decision).toBe("revision_requested");
      });

      await test.step("manual override requires a reason and records distinct override truth", async () => {
        await clickSlice(page, "Awaiting Approval");
        await clickQueueRow(page, fixture.override.label);
        await page.getByRole("button", { name: /^Manual Override$/i }).click();
        await page.getByRole("heading", { name: /Manual Approval Override/i }).waitFor({ state: "visible", timeout: 30_000 });

        const submit = page.getByRole("button", { name: /record manual override/i }).last();
        await expect(submit).toBeDisabled();

        const invalidOverride = await browserSameOriginApi(
          page,
          `/api/proofing/line-item/${fixture.override.id}/manual-approval-override`,
          "POST",
          {
            proofVersionId: fixture.override.proofVersionId,
            overrideReason: "",
          },
        );
        expect(invalidOverride.status).toBe(400);

        await page.locator("#proof-override-reason").fill("Customer approved offline during DEV regression");
        await page.locator("#proof-override-note").fill("Operator documented offline approval");
        await expect(submit).toBeEnabled();
        await submit.click();
        await waitForProofingShell(page);

        const truth = await getTruth(fixture.override.id);
        expect(truth.approvedByOverride).toBe(true);
        expect(truth.approvedProofSource).toBe("manual_override");
        expect(truth.manualApprovalOverrideHistory.length).toBe(1);
        expect(truth.manualApprovalOverrideHistory[0]?.overrideReason).toBe("Customer approved offline during DEV regression");
        expect(truth.proofDecisionHistory.length).toBe(0);

        await clickSlice(page, "Approved");
        await clickQueueRow(page, fixture.override.label);
      });

      await test.step("refresh and guardrails stay aligned with backend truth", async () => {
        await clickSlice(page, "Approved");
        await clickQueueRow(page, fixture.approve.label);

        const stale = await browserSameOriginApi(
          page,
          `/api/proofing/versions/${(await getTruth(fixture.approve.id)).approvedProofVersionId}/respond`,
          "POST",
          {
            decision: "approved",
            responderSource: "stale_regression_check",
          },
        );
        expect(stale.status).toBe(409);

        await page.reload({ waitUntil: "domcontentloaded" });
        await waitForProofingShell(page);
        await page.goto(urlFor(`/orders/${fixture.orderId}`), { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(2_000);
        await page.goto(urlFor("/production/proofing"), { waitUntil: "domcontentloaded" });
        await waitForProofingShell(page);

        const proofingRequests = filterRequests(requestUrls, "/api/proofing/");
        expect(proofingRequests.length).toBeGreaterThan(0);
        expect(proofingRequests.every((url) => url.startsWith(SAME_ORIGIN_API_PREFIX))).toBe(true);
      });
    } finally {
      await cleanupFixture(fixture.orderId);
    }
  });
});

async function waitForProofingShell(page: Page) {
  await expect(page).not.toHaveURL(/\/login/);

  const proofingMain = page.getByRole("main").first();

  try {
    await expect(proofingMain).toContainText("Proofing", { timeout: 30_000 });
    await expect(proofingMain).toContainText("New Proof", { timeout: 30_000 });
    await expect(proofingMain).toContainText("All Proofs", { timeout: 30_000 });
  } catch {
    const body = await page.locator("body").innerText();
    throw new Error(
      `Proofing shell did not render expected controls. url=${page.url()} body=${JSON.stringify(body.slice(0, 500))}`,
    );
  }
}

async function clickSlice(page: Page, label: string) {
  await page.getByRole("tab", { name: new RegExp(`^${escapeRegex(label)}`, "i") }).click();
  await page.waitForTimeout(1_500);
}

async function clickQueueRow(page: Page, label: string) {
  const row = page.locator("aside button").filter({ hasText: label }).first();
  await row.waitFor({ state: "visible", timeout: 30_000 });
  await row.click();
  await page.waitForTimeout(1_500);
}

function getNewProofButton(page: Page) {
  return page.getByRole("button", { name: /^New Proof(?: Version)?$/i }).first();
}

async function expectBodyText(page: Page, text: string) {
  await page.locator("body").filter({ hasText: text }).first().waitFor({ state: "visible", timeout: 30_000 });
}

async function browserSameOriginApi(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(
    async ({ requestPath, requestMethod, requestBody }) => {
      const response = await fetch(requestPath, {
        method: requestMethod,
        credentials: "include",
        headers: requestBody === undefined ? {} : { "Content-Type": "application/json" },
        body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
      });

      let json: any = null;
      try {
        json = await response.json();
      } catch {
        json = null;
      }

      return { ok: response.ok, status: response.status, json };
    },
    { requestPath: path, requestMethod: method, requestBody: body },
  );
}

function filterRequests(requestUrls: Set<string>, fragment: string) {
  return Array.from(requestUrls).filter((url) => url.includes(fragment));
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set in .env.playwright`);
  }
  return value;
}

async function seedFixture(): Promise<Fixture> {
  const [user] = await db.select().from(users).where(eq(users.email, EMAIL)).limit(1);
  expect(user).toBeTruthy();

  const [customer] = await db.select().from(customers).where(eq(customers.organizationId, ORG_ID)).limit(1);
  expect(customer).toBeTruthy();

  const [product] = await db.select().from(products).where(eq(products.organizationId, ORG_ID)).limit(1);
  expect(product).toBeTruthy();

  const [variant] = await db.select().from(productVariants).where(eq(productVariants.productId, product!.id)).limit(1);

  const orderNumber = `PWREG-${Date.now()}`;
  const [order] = await db
    .insert(orders)
    .values({
      organizationId: ORG_ID,
      orderNumber,
      customerId: customer!.id,
      createdByUserId: user!.id,
      status: "new",
      state: "open",
      paymentStatus: "unpaid",
      priority: "normal",
      fulfillmentStatus: "pending",
      subtotal: "50.00",
      tax: "0.00",
      taxAmount: "0.00",
      taxableSubtotal: "50.00",
      total: "50.00",
      discount: "0.00",
      label: `Proofing Regression ${new Date().toISOString()}`,
      billToName: customer!.companyName,
      billToEmail: customer!.email,
      shipToName: customer!.companyName,
      shipToEmail: customer!.email,
    })
    .returning();

  const createLine = async (description: string) => {
    const [line] = await db
      .insert(orderLineItems)
      .values({
        orderId: order.id,
        productId: product!.id,
        productVariantId: variant?.id ?? null,
        productType: product!.productTypeId ? String(product!.productTypeId) : "wide_roll",
        description,
        width: "24.00",
        height: "36.00",
        quantity: 1,
        unitPrice: "10.00",
        totalPrice: "10.00",
        status: "new",
        selectedOptions: [],
        materialUsages: [],
        requiresInventory: false,
        sortOrder: 0,
        workflowState: "ready_for_prepress",
        requiresDesign: false,
        requiresProofApproval: true,
        requiresPrepress: true,
        taxAmount: "0.00",
        isTaxableSnapshot: true,
      })
      .returning();

    return line;
  };

  const createAttachment = async (lineItemId: string, fileName: string) => {
    const bytes = buildPdf(fileName);
    const [attachment] = await db
      .insert(orderAttachments)
      .values({
        orderId: order.id,
        orderLineItemId: lineItemId,
        uploadedByUserId: user!.id,
        uploadedByName: user!.email,
        fileName,
        originalFilename: fileName,
        fileUrl: null,
        fileSize: bytes.length,
        sizeBytes: bytes.length,
        mimeType: "application/pdf",
        role: "proof",
        side: "na",
        isPrimary: false,
        storageProvider: "local",
        thumbStatus: "uploaded",
      })
      .returning();

    return attachment;
  };

  const createLabel = `Proof UI Create Send ${orderNumber}`;
  const approveLabel = `Proof UI Approve ${orderNumber}`;
  const rejectLabel = `Proof UI Reject ${orderNumber}`;
  const revisionLabel = `Proof UI Revision ${orderNumber}`;
  const overrideLabel = `Proof UI Override ${orderNumber}`;

  const createAndSendLine = await createLine(createLabel);
  const approveLine = await createLine(approveLabel);
  const rejectLine = await createLine(rejectLabel);
  const revisionLine = await createLine(revisionLabel);
  const overrideLine = await createLine(overrideLabel);

  const existingAttachment = await createAttachment(createAndSendLine.id, "seed-existing-proof.pdf");
  const approveAttachment = await createAttachment(approveLine.id, "approve-proof.pdf");
  const rejectAttachment = await createAttachment(rejectLine.id, "reject-proof.pdf");
  const revisionAttachment = await createAttachment(revisionLine.id, "revision-proof.pdf");
  const overrideAttachment = await createAttachment(overrideLine.id, "override-proof.pdf");

  const [approveVersion, rejectVersion, revisionVersion, overrideVersion] = await Promise.all([
    createAwaitingApprovalVersion(approveLine.id, approveAttachment.id, user!.id),
    createAwaitingApprovalVersion(rejectLine.id, rejectAttachment.id, user!.id),
    createAwaitingApprovalVersion(revisionLine.id, revisionAttachment.id, user!.id),
    createAwaitingApprovalVersion(overrideLine.id, overrideAttachment.id, user!.id),
  ]);

  return {
    orderId: order.id,
    createAndSend: {
      id: createAndSendLine.id,
      label: createLabel,
      attachmentId: existingAttachment.id,
    },
    approve: { id: approveLine.id, label: approveLabel, proofVersionId: approveVersion.id },
    reject: { id: rejectLine.id, label: rejectLabel, proofVersionId: rejectVersion.id },
    revision: { id: revisionLine.id, label: revisionLabel, proofVersionId: revisionVersion.id },
    override: { id: overrideLine.id, label: overrideLabel, proofVersionId: overrideVersion.id },
  };
}

async function createAwaitingApprovalVersion(lineItemId: string, attachmentId: string, actorUserId: string) {
  return db.transaction(async (tx) => {
    const version = await createLineItemProofVersion(tx, {
      organizationId: ORG_ID,
      lineItemId,
      proofFileId: attachmentId,
      createdByUserId: actorUserId,
    });

    await markProofVersionSent(tx, {
      organizationId: ORG_ID,
      proofVersionId: version.id,
      actorUserId,
    });

    return version;
  });
}

async function getTruth(lineItemId: string) {
  return resolveLineItemProofingTruth(db, { organizationId: ORG_ID, lineItemId });
}

async function cleanupFixture(orderId: string) {
  await db.transaction(async (tx) => {
    await tx.delete(lineItemProofManualApprovalOverrides).where(eq(lineItemProofManualApprovalOverrides.orderId, orderId));
    await tx.delete(lineItemProofApprovals).where(eq(lineItemProofApprovals.orderId, orderId));
    await tx.delete(lineItemProofVersions).where(eq(lineItemProofVersions.orderId, orderId));
    await tx.delete(orderAttachments).where(eq(orderAttachments.orderId, orderId));
    await tx.delete(orderLineItems).where(eq(orderLineItems.orderId, orderId));
    await tx.delete(orders).where(eq(orders.id, orderId));
  });
}

function buildPdf(label: string) {
  return Buffer.from(`%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 58 >>
stream
BT
/F1 24 Tf
72 720 Td
(${label}) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000318 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
417
%%EOF`, "utf8");
}

function urlFor(path: string) {
  return new URL(path, BASE_URL).toString();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function createFreshProofRequiredOrder(page: Page): Promise<FreshOrderFixture> {
  const [customer] = await db
    .select({
      id: customers.id,
      companyName: customers.companyName,
      email: customers.email,
    })
    .from(customers)
    .where(eq(customers.organizationId, ORG_ID))
    .limit(1);
  expect(customer).toBeTruthy();

  const [productFromObservedTruth] = await db
    .select({
      id: products.id,
      name: products.name,
      productTypeId: products.productTypeId,
    })
    .from(products)
    .innerJoin(orderLineItems, eq(orderLineItems.productId, products.id))
    .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
    .where(
      and(
        eq(products.organizationId, ORG_ID),
        eq(products.requiresProofApproval, true),
        eq(orderLineItems.requiresDesign, false),
      ),
    )
    .limit(1);

  const [fallbackProduct] = productFromObservedTruth
    ? [productFromObservedTruth]
    : await db
        .select({
          id: products.id,
          name: products.name,
          productTypeId: products.productTypeId,
        })
        .from(products)
        .where(and(eq(products.organizationId, ORG_ID), eq(products.requiresProofApproval, true)))
        .limit(1);

  expect(fallbackProduct).toBeTruthy();

  const [variant] = await db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(eq(productVariants.productId, fallbackProduct!.id))
    .limit(1);

  const timestamp = Date.now();
  const lineItemLabel = `Proof Gate Fresh ${timestamp}`;

  const createResponse = await page.request.post("/api/orders", {
    data: {
      customerId: customer!.id,
      priority: "normal",
      status: "new",
      deliveryMethod: "pickup",
      lineItems: [
        {
          productId: fallbackProduct!.id,
          variantId: variant?.id ?? null,
          description: lineItemLabel,
          quantity: 1,
          unitPrice: 10,
          totalPrice: 10,
          linePrice: 10,
          productType: fallbackProduct!.productTypeId ? String(fallbackProduct!.productTypeId) : "wide_roll",
          width: 24,
          height: 36,
          selectedOptions: [],
        },
      ],
    },
  });

  const createBody = await createResponse.json().catch(() => ({}));
  expect(createResponse.ok(), JSON.stringify(createBody)).toBe(true);

  const orderId = String(createBody.id);
  const orderNumber = String(createBody.orderNumber);

  const [lineItem] = await db
    .select({
      id: orderLineItems.id,
      description: orderLineItems.description,
      requiresProofApproval: orderLineItems.requiresProofApproval,
      workflowState: orderLineItems.workflowState,
    })
    .from(orderLineItems)
    .where(eq(orderLineItems.orderId, orderId))
    .limit(1);

  expect(lineItem).toBeTruthy();
  expect(lineItem?.requiresProofApproval).toBe(true);
  expect(lineItem?.workflowState).toBe("awaiting_proof_approval");

  return {
    orderId,
    orderNumber,
    lineItemId: lineItem!.id,
    lineItemLabel: String(lineItem!.description || lineItemLabel),
    productName: fallbackProduct!.name,
  };
}

async function getProofingQueueRow(page: Page, lineItemId: string) {
  const response = await page.request.get("/api/proofing/queue?slice=all");
  expect(response.ok()).toBe(true);
  const body = await response.json();
  const rows: any[] = body?.data?.rows ?? [];
  return rows.find((row) => row.lineItemId === lineItemId) ?? null;
}