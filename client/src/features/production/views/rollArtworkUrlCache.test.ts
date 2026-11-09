import { RollArtworkUrlCache } from "./rollArtworkUrlCache";

const mockGet = jest.fn();
jest.mock("@/lib/artworkAccess", () => ({ getArtworkObjectUrl: (...args: unknown[]) => mockGet(...args) }));

beforeEach(() => {
  mockGet.mockReset();
  URL.revokeObjectURL = jest.fn();
});

test("reopening a group reuses the authenticated thumbnail and board cleanup revokes it", async () => {
  mockGet.mockResolvedValue("blob:roll-art-a");
  const cache = new RollArtworkUrlCache();
  expect(await cache.get("art-a", "thumbnail")).toBe("blob:roll-art-a");
  expect(await cache.get("art-a", "thumbnail")).toBe("blob:roll-art-a");
  expect(mockGet).toHaveBeenCalledTimes(1);
  cache.dispose();
  await Promise.resolve();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:roll-art-a");
});

test("a failed thumbnail can retry after refresh", async () => {
  mockGet.mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValueOnce("blob:retry");
  const cache = new RollArtworkUrlCache();
  await expect(cache.get("art-a", "thumbnail")).rejects.toThrow("Unavailable");
  await expect(cache.get("art-a", "thumbnail")).resolves.toBe("blob:retry");
  expect(mockGet).toHaveBeenCalledTimes(2);
  cache.dispose();
});
