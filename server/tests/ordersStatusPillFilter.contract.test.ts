import { readFileSync } from "node:fs";
import path from "node:path";

const read = (relativePath: string) => readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("Orders status-pill multi-select contract", () => {
  it("passes the plural filter from the route into the paginated repository", () => {
    const route = read("server/routes/orders.routes.ts");

    expect(route).toContain("parseOrderStatusPillIdsQuery(req.query.statusPillIds)");
    expect(route).toContain("...(statusPillIds !== undefined ? { statusPillIds } : {})");
  });

  it("applies selected pills, including an explicit empty selection, before count and pagination", () => {
    const repository = read("server/storage/orders.repo.ts");
    const filterIndex = repository.indexOf("if (opts.statusPillIds !== undefined)");
    const countIndex = repository.indexOf("const [{ totalCount }]");
    const paginationIndex = repository.indexOf(".limit(pageSize)");

    expect(repository).toContain("? inArray(orders.statusPillId, opts.statusPillIds)");
    expect(repository).toContain(": sql`false`");
    expect(filterIndex).toBeGreaterThan(-1);
    expect(filterIndex).toBeLessThan(countIndex);
    expect(filterIndex).toBeLessThan(paginationIndex);
  });
});
