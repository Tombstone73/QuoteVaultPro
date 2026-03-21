import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";

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

test.describe.serial("staff proofing DEV regression", () => {
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

        await page.getByRole("button", { name: /^New proof version$/i }).click();
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
        await page.getByRole("button", { name: /^New proof version$/i }).click();
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
        await page.getByRole("button", { name: /send selected draft for review/i }).click();
        await page.getByRole("heading", { name: /Send Proof for Review/i }).waitFor({ state: "visible", timeout: 30_000 });
        await page.locator("#proof-send-name").fill("DEV Regression");
        await page.locator("#proof-send-email").fill("dev-regression@example.com");
        await page.locator("#proof-customer-message").fill("Regression smoke send");
        await page.getByRole("button", { name: /send draft version/i }).click();
        await waitForProofingShell(page);

        let truth = await getTruth(fixture.createAndSend.id);
        expect(truth.currentActionableProofVersion?.status).toBe("awaiting_response");

        await clickSlice(page, "Awaiting Approval");

        await clickQueueRow(page, fixture.approve.label);
        await page.locator("#proof-response-notes").fill("Approved in regression test");
        await page.getByRole("button", { name: /^Approve$/i }).click();
        await waitForProofingShell(page);
        truth = await getTruth(fixture.approve.id);
        expect(truth.approvedNormally).toBe(true);
        expect(truth.approvedProofSource).toBe("normal");

        await clickQueueRow(page, fixture.reject.label);
        await page.locator("#proof-response-notes").fill("Rejected in regression test");
        await page.getByRole("button", { name: /^Reject$/i }).click();
        await waitForProofingShell(page);
        truth = await getTruth(fixture.reject.id);
        expect(truth.workflowState).toBe("needs_design");
        expect(truth.proofDecisionHistory[0]?.decision).toBe("rejected");

        await clickQueueRow(page, fixture.revision.label);
        await page.locator("#proof-response-notes").fill("Revision requested in regression test");
        await page.getByRole("button", { name: /^Revision$/i }).click();
        await waitForProofingShell(page);
        truth = await getTruth(fixture.revision.id);
        expect(truth.workflowState).toBe("needs_design");
        expect(truth.proofDecisionHistory[0]?.decision).toBe("revision_requested");
      });

      await test.step("manual override requires a reason and records distinct override truth", async () => {
        await clickSlice(page, "Awaiting Approval");
        await clickQueueRow(page, fixture.override.label);
        await page.getByRole("button", { name: /record manual override/i }).click();
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
        expect(truth.proofDecisionHistory.length).toBe(0);

        await clickSlice(page, "Approved");
        await clickQueueRow(page, fixture.override.label);
        await expectBodyText(page, "Customer approved offline during DEV regression");
      });

      await test.step("refresh and guardrails stay aligned with backend truth", async () => {
        await clickSlice(page, "Approved");
        await clickQueueRow(page, fixture.approve.label);

        await expect(page.getByRole("button", { name: /send selected draft for review/i })).toBeDisabled();
        await expect(page.getByRole("button", { name: /^Approve$/i })).toBeDisabled();
        await expect(page.getByRole("button", { name: /^Reject$/i })).toBeDisabled();
        await expect(page.getByRole("button", { name: /^Revision$/i })).toBeDisabled();

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
  await page.waitForTimeout(4_000);
  const body = await page.locator("body").innerText();
  if (body.includes("Loading...") && !body.includes("Staff Proofing")) {
    throw new Error(`Page remained stuck on Loading. url=${page.url()} body=${JSON.stringify(body.slice(0, 500))}`);
  }
  if (!body.includes("Staff Proofing")) {
    throw new Error(`Staff Proofing shell did not render. url=${page.url()} body=${JSON.stringify(body.slice(0, 500))}`);
  }
  await expect(page).not.toHaveURL(/\/login/);
}

async function clickSlice(page: Page, label: string) {
  await page.getByRole("tab", { name: new RegExp(`^${escapeRegex(label)}`, "i") }).click();
  await page.waitForTimeout(1_500);
}

async function clickQueueRow(page: Page, label: string) {
  const row = page.locator("button").filter({ hasText: label }).first();
  await row.waitFor({ state: "visible", timeout: 30_000 });
  await row.click();
  await page.waitForTimeout(1_500);
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