import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { PublicWebResearchClient, createPublicWebResearchTools, containsHighRiskEgress } from "../services/assistant/publicWebResearch";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const context: any = { scope: { organizationId: "org_a", userId: "user_a" }, actor: { userId: "user_a", email: null }, permissions: ["assistant.internal_staff"], context: {}, correlationId: "c", goal: "research" };

describe("public web research boundary", () => {
  test.each(["http://localhost/", "http://127.0.0.1/", "http://10.0.0.1/", "http://169.254.169.254/", "http://[::1]/", "http://[::ffff:c0a8:1]/", "http://[ff02::1]/", "file:///etc/passwd", "https://user:pass@example.com/"])('blocks unsafe destinations: %s', async (url) => {
    const client = new PublicWebResearchClient(publicLookup, async () => { throw new Error("must not request"); });
    await expect(client.open(url)).rejects.toThrow("Unsafe public web destination");
  });

  test("revalidates redirect destinations before making a second request", async () => {
    let calls = 0;
    const client = new PublicWebResearchClient(async (host) => host === "private.test" ? [{ address: "10.0.0.1", family: 4 }] : await publicLookup(), async () => {
      calls += 1; return { statusCode: 302, headers: { location: "http://private.test/" }, body: Buffer.alloc(0) };
    });
    await expect(client.open("https://public.test/")).rejects.toThrow("Unsafe public web destination");
    expect(calls).toBe(1);
  });

  test("enforces redirect and content-type limits", async () => {
    const redirects = new PublicWebResearchClient(publicLookup, async () => ({ statusCode: 302, headers: { location: "https://public.test/again" }, body: Buffer.alloc(0) }));
    await expect(redirects.open("https://public.test/")).rejects.toThrow("redirect limit");
    const unsupported = new PublicWebResearchClient(publicLookup, async () => ({ statusCode: 200, headers: { "content-type": "image/png" }, body: Buffer.alloc(1) }));
    await expect(unsupported.open("https://public.test/")).rejects.toThrow("content type");
  });

  test("returns bounded extracted text from a public page", async () => {
    const client = new PublicWebResearchClient(publicLookup, async () => ({ statusCode: 200, headers: { "content-type": "text/html" }, body: Buffer.from("<title>Example</title><script>secret()</script><h1>Hello</h1>") }));
    await expect(client.open("https://example.test/")).resolves.toMatchObject({ domain: "example.test", title: "Example", text: "Example Hello", truncated: false });
  });

  test("search tool never accepts obvious private egress payloads and open is a semantic observation", async () => {
    const [search, open] = createPublicWebResearchTools(new PublicWebResearchClient(publicLookup, async () => ({ statusCode: 200, headers: { "content-type": "text/plain" }, body: Buffer.from("Public facts") })));
    await expect(search.execute({ arguments: { query: "customer@example.com invoices" }, context })).resolves.toMatchObject({ status: "rejected" });
    await expect(open.execute({ arguments: { url: "https://example.test/" }, context })).resolves.toMatchObject({ status: "succeeded", result: { data: { sourceType: "public_web", text: "Public facts" } } });
  });
});


describe("research egress and source provenance", () => {
  const fetchOriginal = global.fetch;
  const keyOriginal = process.env.PUBLIC_WEB_SEARCH_API_KEY;
  afterEach(() => { global.fetch = fetchOriginal; if (keyOriginal === undefined) delete process.env.PUBLIC_WEB_SEARCH_API_KEY; else process.env.PUBLIC_WEB_SEARCH_API_KEY = keyOriginal; });
  test("rejects private customer and pricing facts from trusted internal observations", async () => {
    const privateContext = { ...context, analysisObservations: [{ toolName: "products.get_pricing", result: { data: { basePriceCents: 400, margin: 0.6 } } }, { toolName: "customers.get_summary", result: { data: { customerName: "Private Company" } } }] };
    expect(containsHighRiskEgress("banner $4 per sqft", privateContext)).toBe(true);
    expect(containsHighRiskEgress("banner $4.00 per sqft", privateContext)).toBe(true);
    expect(containsHighRiskEgress("banner 60%", privateContext)).toBe(true);
    expect(containsHighRiskEgress("contact buyer%40example.com")).toBe(true);
    expect(containsHighRiskEgress("Private Company banner order", privateContext)).toBe(true);
    expect(containsHighRiskEgress("banner vinyl 24 x 36 public price", privateContext)).toBe(false);
    const [search, open] = createPublicWebResearchTools();
    expect((await search.execute({ arguments: { query: "Private Company banner order" }, context: privateContext })).status).toBe("rejected");
    expect((await open.execute({ arguments: { url: "https://example.test/?customer=Private%20Company" }, context: privateContext })).status).toBe("rejected");
  });
  test("configured public search returns actual sources, access classification and retrieval time", async () => {
    process.env.PUBLIC_WEB_SEARCH_API_KEY = "fixture-key";
    const fetchMock = jest.fn(async (_url: unknown, _init?: unknown) => ({ ok: true, json: async () => ({ web: { results: [{ title: "Public banner prices", url: "https://example.test/pricing", description: "Listed pricing; login required for contract rates." }] } }) }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const [search] = createPublicWebResearchTools();
    const outcome = await search.execute({ arguments: { query: "banner competitor public pricing" }, context });
    expect(outcome).toMatchObject({ status: "succeeded", result: { data: { sourceType: "public_web", access: "public_unauthenticated", retrievedAt: expect.any(String), results: [{ url: "https://example.test/pricing", title: "Public banner prices" }] } } });
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("Private Company");
  });
  test("public research still requires an authorized tenant staff context", async () => {
    for (const tool of createPublicWebResearchTools()) expect((await tool.execute({ arguments: {}, context: { ...context, permissions: [] } })).status).toBe("permission_denied");
  });
});
