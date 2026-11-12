import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { apiRequest } from "@/lib/queryClient";
import type { PortalRole } from "@shared/portalPermissions";
import { ContactPortalRoleField } from "./ContactPortalRoleField";

jest.mock("@/lib/queryClient", () => ({ apiRequest: jest.fn() }));
jest.mock("@/hooks/useActiveOrganizationRole", () => ({ useActiveOrganizationRole: () => ({ activeOrgId: "tenant", isAdminOrOwner: true }) }));

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { act(() => root.unmount()); client.clear(); container.remove(); });

test("first and subsequent company defaults are previews while an explicit choice survives a count refresh", async () => {
  jest.mocked(apiRequest).mockImplementation(async (_method, url) => ({ json: async () => url.includes("/empty/") ? [] : [{ id: "existing" }] }) as Response);
  const onChoice = jest.fn();
  function Form({ customerId }: { customerId: string }) {
    const [role, setRole] = useState<PortalRole>();
    return <ContactPortalRoleField customerId={customerId} value={role} onChange={next => { setRole(next); onChoice(next); }} />;
  }
  async function render(customerId: string) {
    await act(async () => {
      root.render(<QueryClientProvider client={client}><Form customerId={customerId} /></QueryClientProvider>);
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    return container.querySelector("select")!;
  }
  const first = await render("empty");
  expect(first.selectedOptions[0].textContent).toBe("Default · Company Admin");
  expect(first.value).toBe("");
  expect(onChoice).not.toHaveBeenCalled();
  const later = await render("populated");
  expect(later.selectedOptions[0].textContent).toBe("Default · Buyer");
  await act(async () => { later.value = "VIEWER"; Simulate.change(later); });
  expect(onChoice).toHaveBeenLastCalledWith("VIEWER");
  await act(async () => client.invalidateQueries({ queryKey: ["company-contact-count"] }));
  expect(later.value).toBe("VIEWER");
});
