/// <reference types="jest" />

import { TextDecoder, TextEncoder } from "util";
import InkMasterPage from "./ink-master";

Object.assign(globalThis, { TextDecoder, TextEncoder });
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");

jest.mock("@/hooks/useActiveOrganizationRole", () => ({
  useActiveOrganizationRole: () => ({ activeOrgId: "org-a", isLoading: false }),
}));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/lib/queryClient", () => ({ apiFetch: jest.fn() }));
jest.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[1] === "printers" ? [{
      id: "printer-a", organizationId: "org-a", name: "Digitech Flatbed", isActive: true,
      containerSizeLiters: 1, containerPriceCents: null, restockTargetLiters: 4,
      createdAt: "2026-10-09T00:00:00Z", updatedAt: "2026-10-09T00:00:00Z",
    }] : [],
    isLoading: false, isError: false,
  }),
  useMutation: () => ({ mutate: jest.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

describe("Ink Master compact calculator", () => {
  test("keeps all five usage and inventory inputs visible in responsive rows", () => {
    const html = renderToStaticMarkup(<InkMasterPage />);
    expect(html).toContain("lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]");
    expect(html).toContain("sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.7fr)]");
    expect(html.match(/lg:grid-cols-5/g)).toHaveLength(2);
    for (const color of ["cyan", "magenta", "yellow", "black", "white"]) {
      expect(html).toContain(`id="ink-usage-${color}"`);
      expect(html).toContain(`id="ink-on-hand-${color}"`);
    }
    expect(html).toContain("Saved job spec");
    expect(html).toContain("Job Summary");
    expect(html).toContain("Enter current inventory for each color");
    expect(html).not.toContain("min-w-[520px]");
  });
});
