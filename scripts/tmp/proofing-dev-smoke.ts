import "dotenv/config";

import { chromium, type Page } from "playwright";
import { eq } from "drizzle-orm";

import { db } from "../../server/db";
import {
  createLineItemProofVersion,
  markProofVersionSent,
  resolveLineItemProofingTruth,
} from "../../server/services/proofingService";
import {
  customers,
  orderAttachments,
  orderLineItems,
  orders,
  productVariants,
  products,
  users,
} from "../../shared/schema";

const ORG_ID = "org_titan_001";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "https://dev.printershero.com";
const EMAIL = process.env.PLAYWRIGHT_EMAIL || "titangraphics1@gmail.com";
const PASSWORD = process.env.PLAYWRIGHT_PASSWORD || "sandbox123";

type FixtureLine = {
  id: string;
  label: string;
  attachmentId?: string;
  proofVersionId?: string;
};

type Fixture = {
  orderId: string;
  orderNumber: string;
  createAndSend: FixtureLine;
  approve: FixtureLine;
  reject: FixtureLine;
  revision: FixtureLine;
  override: FixtureLine;
};

type Check = {
  id: string;
  pass: boolean;
  detail: string;
  data?: unknown;
};

const checks: Check[] = [];
const requestUrls = new Set<string>();

async function main() {
  const fixture = await seedFixture();
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage();

  page.on("request", (request) => {
    requestUrls.add(request.url());
  });

  try {
    await record("browser-bootstrap", async () => {
      await login(page);
      await page.goto(urlFor("/production/proofing"), { waitUntil: "domcontentloaded" });
      await waitForProofingShell(page);

      const authRequests = Array.from(requestUrls).filter(
        (url) => url.includes("/api/auth/login") || url.includes("/api/auth/session"),
      );

      expect(authRequests.length > 0, "Expected auth bootstrap requests during login flow");
      expect(
        authRequests.every((url) => url.startsWith(`${BASE_URL}/api/`)),
        `Detected wrong-host auth request(s): ${JSON.stringify(authRequests)}`,
      );

      return { authRequests, finalUrl: page.url() };
    });

    await record("existing-file-draft-flow", async () => {
      await clickSlice(page, "All");
      await clickQueueRow(page, fixture.createAndSend.label);
      await expectBodyText(page, fixture.createAndSend.label);
      await expectBodyText(page, "seed-existing-proof.pdf");

      const filesRequestsBefore = filterRequests(
        `/api/orders/${fixture.orderId}/line-items/${fixture.createAndSend.id}/files`,
      );

      await page.getByRole("button", { name: /^New proof version$/i }).click();
      await page.getByRole("heading", { name: /Create Proof Version/i }).waitFor({
        state: "visible",
        timeout: 30000,
      });
      await page.locator("button").filter({ hasText: "seed-existing-proof.pdf" }).first().click();
      await page.getByRole("button", { name: /create draft version/i }).click();
      await waitForProofingShell(page);

      const truth = await getTruth(fixture.createAndSend.id);
      expect(
        truth.proofVersionHistory.length === 1,
        `Expected 1 proof version after existing-file create, found ${truth.proofVersionHistory.length}`,
      );
      expect(
        truth.currentActionableProofVersion?.status === "draft",
        `Expected created proof to be draft, found ${truth.currentActionableProofVersion?.status}`,
      );

      const filesRequestsAfter = filterRequests(
        `/api/orders/${fixture.orderId}/line-items/${fixture.createAndSend.id}/files`,
      );
      expect(filesRequestsAfter.length >= filesRequestsBefore.length, "Expected line-item files request during existing-file flow");
      expect(
        filesRequestsAfter.every((url) => url.startsWith(`${BASE_URL}/api/`)),
        `Detected wrong-host line-item files request(s): ${JSON.stringify(filesRequestsAfter)}`,
      );

      return { currentVersionId: truth.currentActionableProofVersion?.id };
    });

    await record("upload-draft-flow", async () => {
      await page.getByRole("button", { name: /^New proof version$/i }).click();
      await page.getByRole("heading", { name: /Create Proof Version/i }).waitFor({
        state: "visible",
        timeout: 30000,
      });
      await page.locator("#proof-upload-file").setInputFiles({
        name: "uploaded-proof-v2.pdf",
        mimeType: "application/pdf",
        buffer: buildPdf("uploaded-proof-v2"),
      });
      await page.getByRole("button", { name: /create draft version/i }).click();
      await waitForProofingShell(page);

      const truth = await getTruth(fixture.createAndSend.id);
      expect(
        truth.proofVersionHistory.length === 2,
        `Expected 2 proof versions after upload flow, found ${truth.proofVersionHistory.length}`,
      );
      expect(
        truth.currentActionableProofVersion?.status === "draft",
        `Expected latest version to remain draft, found ${truth.currentActionableProofVersion?.status}`,
      );
      expect(
        truth.currentActionableProofVersion?.proofFileId !== fixture.createAndSend.attachmentId,
        "Expected uploaded draft to bind a new attachment id",
      );
      await expectBodyText(page, "uploaded-proof-v2.pdf");

      return { latestVersionId: truth.currentActionableProofVersion?.id };
    });

    await record("workflow-actions", async () => {
      await clickSlice(page, "Awaiting Send");
      await clickQueueRow(page, fixture.createAndSend.label);
      await page.getByRole("button", { name: /send selected draft for review/i }).click();
      await page.getByRole("heading", { name: /Send Proof for Review/i }).waitFor({
        state: "visible",
        timeout: 30000,
      });
      await page.locator("#proof-send-name").fill("DEV Smoke");
      await page.locator("#proof-send-email").fill("dev-smoke@example.com");
      await page.locator("#proof-customer-message").fill("Smoke validation send");
      await page.getByRole("button", { name: /send draft version/i }).click();
      await waitForProofingShell(page);

      let truth = await getTruth(fixture.createAndSend.id);
      expect(
        truth.currentActionableProofVersion?.status === "awaiting_response",
        `Expected sent proof to await response, found ${truth.currentActionableProofVersion?.status}`,
      );

      await clickSlice(page, "Awaiting Approval");

      await clickQueueRow(page, fixture.approve.label);
      await page.locator("#proof-response-notes").fill("Approved in DEV smoke");
      await page.getByRole("button", { name: /^Approve$/i }).click();
      await waitForProofingShell(page);
      truth = await getTruth(fixture.approve.id);
      expect(truth.approvedNormally === true, "Approve flow did not set approvedNormally=true");
      expect(
        truth.approvedProofSource === "normal",
        `Approve flow expected source normal, found ${truth.approvedProofSource}`,
      );

      await clickQueueRow(page, fixture.reject.label);
      await page.locator("#proof-response-notes").fill("Rejected in DEV smoke");
      await page.getByRole("button", { name: /^Reject$/i }).click();
      await waitForProofingShell(page);
      truth = await getTruth(fixture.reject.id);
      expect(
        truth.workflowState === "needs_design",
        `Reject flow expected needs_design, found ${truth.workflowState}`,
      );
      expect(
        truth.proofDecisionHistory[0]?.decision === "rejected",
        `Reject flow expected rejected decision, found ${truth.proofDecisionHistory[0]?.decision}`,
      );

      await clickQueueRow(page, fixture.revision.label);
      await page.locator("#proof-response-notes").fill("Revision requested in DEV smoke");
      await page.getByRole("button", { name: /^Revision$/i }).click();
      await waitForProofingShell(page);
      truth = await getTruth(fixture.revision.id);
      expect(
        truth.workflowState === "needs_design",
        `Revision flow expected needs_design, found ${truth.workflowState}`,
      );
      expect(
        truth.proofDecisionHistory[0]?.decision === "revision_requested",
        `Revision flow expected revision_requested, found ${truth.proofDecisionHistory[0]?.decision}`,
      );

      return {
        approveState: (await getTruth(fixture.approve.id)).approvedProofSource,
        rejectState: (await getTruth(fixture.reject.id)).workflowState,
        revisionState: (await getTruth(fixture.revision.id)).workflowState,
      };
    });

    await record("manual-override", async () => {
      await clickSlice(page, "Awaiting Approval");
      await clickQueueRow(page, fixture.override.label);
      await page.getByRole("button", { name: /record manual override/i }).click();
      await page.getByRole("heading", { name: /Manual Approval Override/i }).waitFor({
        state: "visible",
        timeout: 30000,
      });

      const submit = page.getByRole("button", { name: /record manual override/i }).last();
      expect(await submit.isDisabled(), "Manual override submit should be disabled when reason is blank");

      const invalidOverride = await browserSameOriginApi(
        page,
        `/api/proofing/line-item/${fixture.override.id}/manual-approval-override`,
        "POST",
        {
          proofVersionId: fixture.override.proofVersionId,
          overrideReason: "",
        },
      );
      expect(invalidOverride.status === 400, `Expected blank override reason to fail with 400, found ${invalidOverride.status}`);

      await page.locator("#proof-override-reason").fill("Customer approved offline during DEV smoke");
      await page.locator("#proof-override-note").fill("Operator documented offline approval");
      expect(!(await submit.isDisabled()), "Manual override submit should enable once a reason is entered");
      await submit.click();
      await waitForProofingShell(page);

      const truth = await getTruth(fixture.override.id);
      expect(truth.approvedByOverride === true, "Manual override did not set approvedByOverride=true");
      expect(
        truth.approvedProofSource === "manual_override",
        `Expected manual override source, found ${truth.approvedProofSource}`,
      );
      expect(
        truth.manualApprovalOverrideHistory.length === 1,
        `Expected one override history row, found ${truth.manualApprovalOverrideHistory.length}`,
      );
      expect(
        truth.proofDecisionHistory.length === 0,
        `Expected override to remain distinct from normal proof decisions, found ${truth.proofDecisionHistory.length}`,
      );
      await expectBodyText(page, "Customer approved offline during DEV smoke");

      return { approvedProofSource: truth.approvedProofSource };
    });

    await record("guardrails", async () => {
      await clickSlice(page, "Approved");
      await clickQueueRow(page, fixture.approve.label);
      expect(
        await page.getByRole("button", { name: /send selected draft for review/i }).isDisabled(),
        "Send action should be disabled on approved proof",
      );
      expect(
        await page.getByRole("button", { name: /^Approve$/i }).isDisabled(),
        "Approve action should be disabled on approved proof",
      );
      expect(
        await page.getByRole("button", { name: /^Reject$/i }).isDisabled(),
        "Reject action should be disabled on approved proof",
      );
      expect(
        await page.getByRole("button", { name: /^Revision$/i }).isDisabled(),
        "Revision action should be disabled on approved proof",
      );

      const stale = await browserSameOriginApi(
        page,
        `/api/proofing/versions/${(await getTruth(fixture.approve.id)).approvedProofVersionId}/respond`,
        "POST",
        {
          decision: "approved",
          responderSource: "stale_smoke_check",
        },
      );
      expect(stale.status === 409, `Expected stale response to fail with 409, found ${stale.status}`);

      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForProofingShell(page);
      await page.goto(urlFor(`/orders/${fixture.orderId}`), { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      await page.goto(urlFor("/production/proofing"), { waitUntil: "domcontentloaded" });
      await waitForProofingShell(page);

      const proofingRequests = filterRequests("/api/proofing/");
      expect(proofingRequests.length > 0, "Expected proofing API requests during smoke run");
      expect(
        proofingRequests.every((url) => url.startsWith(`${BASE_URL}/api/`)),
        `Detected wrong-host proofing request(s): ${JSON.stringify(proofingRequests)}`,
      );

      return { proofingRequests };
    });

    console.log(
      JSON.stringify(
        {
          ok: checks.every((check) => check.pass),
          orderId: fixture.orderId,
          orderNumber: fixture.orderNumber,
          checks,
          totals: {
            passed: checks.filter((check) => check.pass).length,
            failed: checks.filter((check) => !check.pass).length,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

async function login(page: Page) {
  await page.goto(urlFor("/login"), { waitUntil: "domcontentloaded" });
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForTimeout(5000);
}

async function waitForProofingShell(page: Page) {
  await page.waitForTimeout(4000);
  const body = await page.locator("body").innerText();
  if (body.includes("Loading...") && !body.includes("Staff Proofing")) {
    throw new Error(`Page remained stuck on Loading. url=${page.url()} body=${JSON.stringify(body.slice(0, 500))}`);
  }
  if (!body.includes("Staff Proofing")) {
    throw new Error(`Staff Proofing shell did not render. url=${page.url()} body=${JSON.stringify(body.slice(0, 500))}`);
  }
}

async function clickSlice(page: Page, label: string) {
  await page.getByRole("tab", { name: new RegExp(`^${escapeRegex(label)}`, "i") }).click();
  await page.waitForTimeout(1500);
}

async function clickQueueRow(page: Page, label: string) {
  const row = page.locator("button").filter({ hasText: label }).first();
  await row.waitFor({ state: "visible", timeout: 30000 });
  await row.click();
  await page.waitForTimeout(1500);
}

async function expectBodyText(page: Page, text: string) {
  await page.locator("body").filter({ hasText: text }).first().waitFor({ state: "visible", timeout: 30000 });
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

function filterRequests(fragment: string) {
  return Array.from(requestUrls).filter((url) => url.includes(fragment));
}

async function seedFixture(): Promise<Fixture> {
  const [user] = await db.select().from(users).where(eq(users.email, EMAIL)).limit(1);
  expect(!!user, `Validation user not found for ${EMAIL}`);

  const [customer] = await db.select().from(customers).where(eq(customers.organizationId, ORG_ID)).limit(1);
  expect(!!customer, `No customer found in ${ORG_ID}`);

  const [product] = await db.select().from(products).where(eq(products.organizationId, ORG_ID)).limit(1);
  expect(!!product, `No product found in ${ORG_ID}`);

  const [variant] = await db.select().from(productVariants).where(eq(productVariants.productId, product!.id)).limit(1);

  const orderNumber = `PSMOKE-${Date.now()}`;
  const [order] = await db.insert(orders).values({
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
    label: `Proofing Browser Smoke ${new Date().toISOString()}`,
    billToName: customer!.companyName,
    billToEmail: customer!.email,
    shipToName: customer!.companyName,
    shipToEmail: customer!.email,
  }).returning();

  const createLine = async (description: string) => {
    const [line] = await db.insert(orderLineItems).values({
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
    }).returning();
    return line;
  };

  const createAttachment = async (lineItemId: string, fileName: string) => {
    const bytes = buildPdf(fileName);
    const [attachment] = await db.insert(orderAttachments).values({
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
    }).returning();
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
    orderNumber,
    createAndSend: { id: createAndSendLine.id, label: createLabel, attachmentId: existingAttachment.id },
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

async function record<T>(id: string, fn: () => Promise<T>) {
  try {
    const data = await fn();
    checks.push({ id, pass: true, detail: "ok", data });
    return data;
  } catch (error: any) {
    checks.push({ id, pass: false, detail: error?.message || String(error) });
    throw error;
  }
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

main().catch((error) => {
  console.error(error);
  console.log(
    JSON.stringify(
      {
        ok: false,
        checks,
        totals: {
          passed: checks.filter((check) => check.pass).length,
          failed: checks.filter((check) => !check.pass).length,
        },
      },
      null,
      2,
    ),
  );
  process.exit(1);
});