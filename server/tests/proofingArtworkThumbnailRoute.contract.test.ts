import fs from "node:fs";
import path from "node:path";

describe("Proofing artwork thumbnail response", () => {
  test("uses the resolved derivative MIME type instead of the source PDF MIME type", () => {
    const routeSource = fs.readFileSync(path.join(process.cwd(), "server/routes/proofing.routes.ts"), "utf8");

    expect(routeSource).toContain('res.type(preview.mimeType || source.mimeType || "application/octet-stream")');
  });
});
