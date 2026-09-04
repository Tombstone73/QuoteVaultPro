import { describe, expect, it } from "@jest/globals";

import { canManageCustomerCommercialConfiguration } from "../services/customerCommercialConfigurationAccess";

describe("customer commercial configuration access", () => {
  it("restricts payment terms and credit-limit management to organization owners and admins", () => {
    for (const role of ["owner", "admin", "ADMIN", " Owner "]) {
      expect(canManageCustomerCommercialConfiguration(role)).toBe(true);
    }

    for (const role of [undefined, null, "manager", "staff", "customer", "platform_admin"]) {
      expect(canManageCustomerCommercialConfiguration(role)).toBe(false);
    }
  });
});
