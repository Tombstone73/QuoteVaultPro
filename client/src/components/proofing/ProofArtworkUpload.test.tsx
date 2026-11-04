import { canReturnUpstream } from "@/lib/returnUpstream";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, jest, test } from "@jest/globals";
import { ProofArtworkUpload } from "./ProofArtworkUpload";
import { uploadAttachmentViaChunked } from "@/lib/uploads/chunkedAttachmentUpload";

jest.mock("@/lib/queryClient", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/uploads/chunkedAttachmentUpload", () => ({ uploadAttachmentViaChunked: jest.fn() }));
const upload = jest.mocked(uploadAttachmentViaChunked);
const source = { canonicalArtworkId: "current-artwork", revisionRole: "customer_source", fileName: "source.pdf", allocatedQuantity: 10, side: "front" as const };
const file = new File(["synthetic PDF"], "revision.pdf", { type: "application/pdf" });
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); jest.resetAllMocks(); });
function render(element: React.ReactNode) { act(() => root.render(element)); }
function field(label: string): HTMLInputElement | HTMLSelectElement { const node = Array.from(host.querySelectorAll("label")).find(node => node.textContent === label); return document.getElementById(node!.htmlFor) as HTMLInputElement; }
function change(label: string, value: string | File) { act(() => { const node = field(label); if (typeof value === "string") node.value = value; else Object.defineProperty(node, "files", { value: [value], configurable: true }); node.dispatchEvent(new Event("change", { bubbles: true })); }); }
async function click(label: string) { await act(async () => { Array.from(host.querySelectorAll("button")).find(button => button.textContent === label)!.click(); }); }


test("Add Artwork links only the selected Order line through canonical upload", async () => {
  upload.mockResolvedValue({ uploadId: "session", finalizedFileId: "file", linkResponse: { data: { id: "attachment" } } });
  const onUploaded = jest.fn(async () => {});
  render(<ProofArtworkUpload orderId="order" lineItemId="line" sources={[source]} onUploaded={onUploaded} />);
  change("New source artwork", file);
  await click("Add Artwork");
  expect(onUploaded).toHaveBeenCalledTimes(1);
  expect(upload).toHaveBeenCalledWith(expect.objectContaining({ linkUrl: "/api/orders/order/files", purpose: "order-attachment", linkBody: expect.objectContaining({ orderLineItemId: "line", role: "artwork", replacesArtworkId: null }) }));
});

test("replacement is explicit, preserves source allocation and original identity, failures retain the file", async () => {
  upload.mockRejectedValueOnce(new Error("Storage unavailable"));
  const onUploaded = jest.fn(async () => {});
  render(<ProofArtworkUpload orderId="order" lineItemId="line" sources={[source]} onUploaded={onUploaded} />);
  change("Artwork action", source.canonicalArtworkId);
  change("Replacement source artwork", file);
  await click("Save Artwork Revision");
  expect(host.textContent).toContain("Storage unavailable");
  expect(onUploaded).not.toHaveBeenCalled();
  expect(upload).toHaveBeenCalledWith(expect.objectContaining({ file, linkBody: expect.objectContaining({ replacesArtworkId: "current-artwork", productionQuantity: 10, side: "front" }) }));
  upload.mockResolvedValue({ uploadId: "session", finalizedFileId: "file", linkResponse: { data: { id: "attachment" } } });
  await click("Save Artwork Revision");
  expect(onUploaded).toHaveBeenCalledTimes(1);
});

test("refresh failure retries readback without uploading a duplicate source", async () => {
  upload.mockResolvedValue({ uploadId: "session", finalizedFileId: "file", linkResponse: { data: { id: "attachment" } } });
  const onUploaded = jest.fn<() => Promise<void>>().mockRejectedValueOnce(new Error("Refresh unavailable")).mockResolvedValue(undefined);
  render(<ProofArtworkUpload orderId="order" lineItemId="line" sources={[source]} onUploaded={onUploaded} />);
  change("New source artwork", file);
  await click("Add Artwork");
  expect(host.textContent).toContain("Refresh unavailable");
  await click("Add Artwork");
  expect(onUploaded).toHaveBeenCalledTimes(2);
  expect(upload).toHaveBeenCalledTimes(1);
});


test("Proofing may return to Design without enabling an unsupported return to Proofing", () => {
  const target = { lineItemId: "line", orderId: "order", workflowState: "awaiting_proof_approval" as const,
    activeOwnerJobId: "owner", lineItemUpdatedAt: new Date().toISOString(), isActivelyOwnedByPrepress: true };
  expect(canReturnUpstream(target, true, "design")).toBe(true);
  expect(canReturnUpstream(target, true, "proofing")).toBe(false);
  expect(canReturnUpstream(target, false, "design")).toBe(false);
});
