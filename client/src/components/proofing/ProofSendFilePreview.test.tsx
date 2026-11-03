import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { ProofSendFilePreview } from "./ProofSendFilePreview";
import { apiFetch } from "@/lib/queryClient";

jest.mock("@/lib/queryClient", () => ({ apiFetch: jest.fn() }));
const fetchFile = jest.mocked(apiFetch);
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  jest.useFakeTimers(); fetchFile.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  URL.createObjectURL = jest.fn(() => "blob:authenticated-proof"); URL.revokeObjectURL = jest.fn();
  jest.spyOn(window, "open").mockReturnValue({ closed: true } as Window);
});
afterEach(() => { act(() => root.unmount()); host.remove(); jest.runOnlyPendingTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });
function response(status = 200, type = "application/pdf"): Response {
  return { ok: status === 200, status, headers: { get: () => type }, blob: async () => new Blob(["%PDF-1.7 synthetic"], { type }),
    clone: () => ({ json: async () => ({ error: "Proof file unavailable. Retry file access." }) }), text: async () => "" } as unknown as Response;
}
const url = "/api/proofing/versions/version-6/file/content";
function render(props: Partial<React.ComponentProps<typeof ProofSendFilePreview>> = {}) {
  act(() => root.render(<ProofSendFilePreview key={props.versionId ?? "version-6"} versionId="version-6" url={url} previewUrl="data:image/png;base64,cHJvb2Y=" isPdf ready error={null} {...props}/>));
}
async function open() { await act(async () => { host.querySelector("button")!.click(); }); }

test("renders the loaded version's thumbnail and opens its actual PDF with authenticated API fetch, never a raw link", async () => {
  fetchFile.mockResolvedValue(response()); render();
  expect(host.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,cHJvb2Y=");
  expect(host.querySelector("[data-proof-version-id]")?.getAttribute("data-proof-version-id")).toBe("version-6");
  expect(host.querySelector("a")).toBeNull();
  await open();
  expect(fetchFile).toHaveBeenCalledWith(url, { method: "GET", credentials: "include", headers: { Accept: "application/pdf" } });
  expect(window.open).toHaveBeenCalledWith("blob:authenticated-proof", "_blank", "");
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

test.each([[401, "Sign in"], [403, "permission"], [409, "Retry file access"]])("handles rejected file access (%s) visibly without opening a route", async (status, message) => {
  fetchFile.mockResolvedValue(response(Number(status), "application/json")); render(); await open();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(message);
  expect(window.open).not.toHaveBeenCalled(); expect(host.querySelector("button")!.disabled).toBe(false);
});

test("missing file disables access and explains recovery; a failed thumbnail remains a readable fallback", () => {
  render({ ready: false, url: null, previewUrl: null, error: "Proof file unavailable. Retry file access in the main viewer." });
  expect(host.querySelector("button")!.disabled).toBe(true); expect(host.textContent).toContain("Retry file access");
  expect(host.querySelector("img")).toBeNull(); expect(fetchFile).not.toHaveBeenCalled();
  render({ versionId: "version-7", url: "/api/proofing/versions/version-7/file/content" });
  act(() => host.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(host.textContent).toContain("Proof thumbnail unavailable"); expect(host.querySelector("img")).toBeNull();
});

test("blocks duplicate opens, permits retry after failure, and uses the next selected version's URL", async () => {
  let finish: ((result: Response) => void) | undefined;
  fetchFile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); render();
  act(() => host.querySelector("button")!.click()); act(() => host.querySelector("button")!.click());
  expect(fetchFile).toHaveBeenCalledTimes(1); expect(host.querySelector("button")!.disabled).toBe(true);
  await act(async () => finish?.(response(403, "application/json")));
  fetchFile.mockResolvedValue(response()); await open(); expect(window.open).toHaveBeenCalledTimes(1);
  render({ versionId: "version-7", url: "/api/proofing/versions/version-7/file/content" }); await open();
  expect(fetchFile).toHaveBeenLastCalledWith("/api/proofing/versions/version-7/file/content", expect.objectContaining({ credentials: "include" }));
});

test("image proofs use the existing authenticated image reader", async () => {
  fetchFile.mockResolvedValue(response(200, "image/png")); render({ isPdf: false, previewUrl: "blob:main-viewer-image" }); await open();
  expect(fetchFile).toHaveBeenCalledWith(url, expect.objectContaining({ headers: { Accept: "image/*" }, credentials: "include" }));
  expect(window.open).toHaveBeenCalledWith("blob:authenticated-proof", "_blank", "noopener,noreferrer");
});
