import { describe, expect, test } from "@jest/globals";
import { PublicWebResearchClient, createPublicWebResearchTools } from "../services/assistant/publicWebResearch";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const context: any = { scope: { organizationId: "org_a", userId: "user_a" }, actor: { userId: "user_a", email: null }, permissions: ["assistant.internal_staff"], context: {}, correlationId: "c", goal: "research" };

describe("public web research boundary", () => {
  test.each(["http://localhost/", "http://127.0.0.1/", "http://10.0.0.1/", "http://169.254.169.254/", "http://[::1]/", "file:///etc/passwd", "https://user:pass@example.com/"])('blocks unsafe destinations: %s', async (url) => {
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
