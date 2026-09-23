import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";

const select = jest.fn();
jest.unstable_mockModule("../db", () => ({ db: { select } }));

let resolveOrderCustomerContactIds: typeof import("../services/orderCustomerResolutionService").resolveOrderCustomerContactIds;
let selectedContactId = "contact-1";

beforeAll(async () => {
  ({ resolveOrderCustomerContactIds } = await import("../services/orderCustomerResolutionService"));
});

beforeEach(() => {
  jest.clearAllMocks();
  selectedContactId = "contact-1";
  let query = 0;
  select.mockImplementation(() => {
    query += 1;
    const currentQuery = query;
    const builder: any = {
      from: () => builder,
      innerJoin: () => builder,
      where: () => builder,
      limit: async () => currentQuery === 1 ? [{ id: selectedContactId, customerId: "company-1" }] : [],
      orderBy: async () => [{ id: "company-1", isPrimary: true }],
    };
    return builder;
  });
});

describe("Order contact-only identity resolution", () => {
  test("an explicit Customer clear keeps the same Contact even when it remains linked to that Customer", async () => {
    await expect(resolveOrderCustomerContactIds({
      organizationId: "org-1", customerId: null, contactId: "contact-1", preserveExplicitCustomerClear: true,
    })).resolves.toEqual({ customerId: null, contactId: "contact-1" });
  });

  test("contact-only edits can replace the Contact without reattaching its linked company", async () => {
    selectedContactId = "contact-2";
    await expect(resolveOrderCustomerContactIds({
      organizationId: "org-1", customerId: null, contactId: "contact-2", preserveExplicitCustomerClear: true,
    })).resolves.toEqual({ customerId: null, contactId: "contact-2" });
  });

  test("normal creation/conversion keeps existing linked-customer resolution", async () => {
    await expect(resolveOrderCustomerContactIds({ organizationId: "org-1", customerId: null, contactId: "contact-1" }))
      .resolves.toEqual({ customerId: "company-1", contactId: "contact-1" });
  });

  test("Customer-only and neither-owner inputs remain distinct for repository validation", async () => {
    await expect(resolveOrderCustomerContactIds({ organizationId: "org-1", customerId: "company-1", contactId: null }))
      .resolves.toEqual({ customerId: "company-1", contactId: null });
    await expect(resolveOrderCustomerContactIds({ organizationId: "org-1", customerId: null, contactId: null }))
      .resolves.toEqual({ customerId: null, contactId: null });
  });
});
