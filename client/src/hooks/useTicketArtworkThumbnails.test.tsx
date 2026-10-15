import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useTicketArtworkThumbnails } from "./useTicketArtworkThumbnails";

const mockGetArtworkObjectUrl = jest.fn();
jest.mock("@/lib/artworkAccess", () => ({ getArtworkObjectUrl: (...args: unknown[]) => mockGetArtworkObjectUrl(...args) }));

function Probe({ enabled }: { enabled: boolean }) {
  const thumbnails = useTicketArtworkThumbnails([{ id: "art-1", fileRecordId: "file-1" }], enabled);
  return <div data-status={thumbnails.images["art-1"]?.status ?? "none"} data-loading={String(thumbnails.loading)}>{enabled && thumbnails.images["art-1"]?.src ? <img src={thumbnails.images["art-1"].src} alt="Artwork" /> : null}</div>;
}

let host: HTMLDivElement;
let root: Root;
const originalImage = globalThis.Image;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  mockGetArtworkObjectUrl.mockReset();
  URL.revokeObjectURL = jest.fn();
  (globalThis as any).Image = class { src = ""; decode = () => Promise.resolve(); };
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  globalThis.Image = originalImage;
});

test("thumbnail OFF creates no image or network read; ON uses canonical derivative and releases object URL", async () => {
  await act(async () => root.render(<Probe enabled={false} />));
  expect(mockGetArtworkObjectUrl).not.toHaveBeenCalled();
  expect(host.querySelector("img")).toBeNull();

  mockGetArtworkObjectUrl.mockResolvedValue("blob:thumbnail");
  await act(async () => { root.render(<Probe enabled />); await Promise.resolve(); await Promise.resolve(); });
  expect(mockGetArtworkObjectUrl).toHaveBeenCalledWith("file-1", "thumbnail");
  expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:thumbnail");
  expect(host.firstElementChild?.getAttribute("data-status")).toBe("ready");

  await act(async () => root.render(<Probe enabled={false} />));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:thumbnail");
  expect(host.querySelector("img")).toBeNull();
});

test("failed authenticated thumbnail has unavailable state and no broken image", async () => {
  mockGetArtworkObjectUrl.mockRejectedValue(new Error("expired or missing"));
  await act(async () => { root.render(<Probe enabled />); await Promise.resolve(); await Promise.resolve(); });
  expect(host.firstElementChild?.getAttribute("data-status")).toBe("unavailable");
  expect(host.querySelector("img")).toBeNull();
});

test("a derivative that arrives after thumbnails are disabled is revoked", async () => {
  let resolveUrl!: (value: string) => void;
  mockGetArtworkObjectUrl.mockReturnValue(new Promise<string>(resolve => { resolveUrl = resolve; }));
  await act(async () => root.render(<Probe enabled />));
  await act(async () => root.render(<Probe enabled={false} />));
  await act(async () => { resolveUrl("blob:late"); await Promise.resolve(); });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:late");
  expect(host.querySelector("img")).toBeNull();
});
