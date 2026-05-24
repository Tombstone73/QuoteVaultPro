import { expect, test } from "@playwright/test";

const PAYABLE_NUMBER = Number(process.env.PORTAL_TEST_INVOICE_NUMBER_BASE || "910100");
const PAID_NUMBER = PAYABLE_NUMBER + 1;
const DRAFT_NUMBER = PAYABLE_NUMBER + 2;
const VOID_NUMBER = PAYABLE_NUMBER + 3;

test.describe("customer portal validation seed", () => {
  test("portal invoice UI consumes the safe boundary", async ({ page }) => {
    await page.goto("/portal/invoices", { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
    await expect(page.getByRole("link", { name: `Invoice #${PAYABLE_NUMBER}` })).toBeVisible();
    await expect(page.getByRole("link", { name: `Invoice #${PAID_NUMBER}` })).toBeVisible();
    await expect(page.getByRole("link", { name: `Invoice #${VOID_NUMBER}` })).toBeVisible();
    await expect(page.getByText(`Invoice #${DRAFT_NUMBER}`)).toHaveCount(0);

    await page.getByRole("link", { name: `Invoice #${PAYABLE_NUMBER}` }).click();
    await expect(page.getByRole("heading", { name: `Invoice #${PAYABLE_NUMBER}` })).toBeVisible();
    await expect(page.getByText("Payment History")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Pay / })).toBeEnabled();

    const pdfResponsePromise = page.waitForResponse((response) =>
      response.url().includes(`/api/portal/invoices/`) &&
      response.url().includes(`/pdf`) &&
      response.status() === 200,
    );
    await page.getByRole("button", { name: "PDF" }).click();
    const pdfResponse = await pdfResponsePromise;
    expect(pdfResponse.headers()["content-type"]).toContain("application/pdf");

    await page.goto("/portal/invoices", { waitUntil: "networkidle" });
    await page.getByRole("link", { name: `Invoice #${PAID_NUMBER}` }).click();
    await expect(page.getByRole("heading", { name: `Invoice #${PAID_NUMBER}` })).toBeVisible();
    await expect(page.getByText("This invoice is paid.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Pay / })).toBeDisabled();

    await page.goto("/portal/invoices", { waitUntil: "networkidle" });
    await page.getByRole("link", { name: `Invoice #${VOID_NUMBER}` }).click();
    await expect(page.getByRole("heading", { name: `Invoice #${VOID_NUMBER}` })).toBeVisible();
    await expect(page.getByText("This invoice is no longer payable.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Pay / })).toBeDisabled();

    await page.goto("/portal/invoices/not-a-real-invoice", { waitUntil: "networkidle" });
    await expect(page.getByText("Invoice not found")).toBeVisible();
    await expect(page.getByText("This invoice is unavailable or you do not have access.")).toBeVisible();
  });
});
