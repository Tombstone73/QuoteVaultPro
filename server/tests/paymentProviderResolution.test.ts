import { resolveHostedPaymentProvider } from "../../shared/paymentProviderResolution";

describe("hosted payment provider resolution", () => {
  test("uses the configured default when multiple hosted processors are available", () => {
    const resolution = resolveHostedPaymentProvider({
      configuredDefaultProvider: "eps",
      availableProviders: ["stripe", "eps"],
    });

    expect(resolution.provider).toBe("eps");
    expect(resolution.reason).toBe("configured_default");
  });

  test("does not select competing processors when multiple are available without a default", () => {
    const resolution = resolveHostedPaymentProvider({
      configuredDefaultProvider: "none",
      availableProviders: ["stripe", "eps"],
    });

    expect(resolution.provider).toBeNull();
    expect(resolution.reason).toBe("multiple_available_no_default");
  });

  test("keeps legacy single-provider invoice payment creation on exactly one processor", () => {
    const resolution = resolveHostedPaymentProvider({
      configuredDefaultProvider: "none",
      availableProviders: ["stripe"],
    });

    expect(resolution.provider).toBe("stripe");
    expect(resolution.reason).toBe("single_available_legacy");
  });

  test("rejects an unavailable configured default instead of falling through to another provider", () => {
    const resolution = resolveHostedPaymentProvider({
      configuredDefaultProvider: "eps",
      availableProviders: ["stripe"],
    });

    expect(resolution.provider).toBeNull();
    expect(resolution.reason).toBe("configured_default_unavailable");
  });
});
