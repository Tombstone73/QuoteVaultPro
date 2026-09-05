import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { apiFetch } from "@/lib/queryClient";
import { buildArtworkAccessUrl, downloadArtwork, getArtworkObjectUrl, openArtworkPreview, resolveArtworkDownloadUrl } from "@/lib/artworkAccess";

jest.mock("@/lib/queryClient", () => ({ apiFetch: jest.fn() }));
const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

const response = (ok: boolean, blob = new Blob(["artwork"], { type: "image/png" })) => ({ ok, blob: async () => blob } as Response);

describe("artworkAccess", () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const originalOpen = window.open;

  beforeEach(() => {
    jest.useFakeTimers();
    mockedApiFetch.mockReset();
    URL.createObjectURL = jest.fn(() => "blob:artwork");
    URL.revokeObjectURL = jest.fn();
    window.open = jest.fn(() => ({ closed: false } as Window));
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    window.open = originalOpen;
    jest.restoreAllMocks();
  });

  test("uses the canonical file-record endpoint and rejects invalid identities", () => {
    expect(buildArtworkAccessUrl("fr_1", "preview")).toBe("/api/artwork/file-records/fr_1/content?variant=preview");
    expect(buildArtworkAccessUrl(" ")).toBeNull();
  });

  test("uses canonical original access for downloads and permits legacy URLs only without a file record", () => {
    expect(resolveArtworkDownloadUrl("fr_1", "https://storage.example/stale-signed-url")).toBe("/api/artwork/file-records/fr_1/content?variant=original");
    expect(resolveArtworkDownloadUrl(null, "/legacy/artwork.pdf")).toBe("/legacy/artwork.pdf");
    expect(resolveArtworkDownloadUrl(" ", null, undefined)).toBeNull();
  });

  test("opens a PDF or image only after authenticated Blob fetch", async () => {
    mockedApiFetch.mockResolvedValue(response(true, new Blob(["%PDF"], { type: "application/pdf" })));
    await openArtworkPreview("fr_pdf", "application/pdf");
    expect(mockedApiFetch).toHaveBeenCalledWith("/api/artwork/file-records/fr_pdf/content?variant=original", expect.objectContaining({ credentials: "include" }));
    expect(window.open).toHaveBeenCalledWith("blob:artwork", "_blank", "noopener,noreferrer");
    expect(window.open).not.toHaveBeenCalledWith(expect.stringContaining("/api/artwork/"), "_blank", expect.anything());
    jest.runOnlyPendingTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:artwork");
  });

  test("downloads through a Blob URL and revokes it", async () => {
    const click = jest.fn();
    const remove = jest.fn();
    jest.spyOn(document, "createElement").mockReturnValue({ click, remove, href: "", download: "", rel: "" } as any);
    jest.spyOn(document.body, "appendChild").mockImplementation((node) => node);
    mockedApiFetch.mockResolvedValue(response(true));
    await downloadArtwork("fr_image", "logo.png");
    expect(click).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:artwork");
  });

  test("does not create an object URL when canonical access is denied", async () => {
    mockedApiFetch.mockResolvedValue(response(false));
    await expect(getArtworkObjectUrl("other_tenant_record")).rejects.toThrow("Unable to access artwork");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
