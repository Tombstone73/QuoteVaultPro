export type HostedPaymentProvider = "stripe" | "eps";
export type ConfiguredPaymentProvider = "none" | HostedPaymentProvider;

export type HostedPaymentProviderResolution =
  | {
      provider: HostedPaymentProvider;
      reason: "explicit" | "configured_default" | "single_available_legacy";
      availableProviders: HostedPaymentProvider[];
    }
  | {
      provider: null;
      reason:
        | "none_available"
        | "explicit_unavailable"
        | "configured_default_unavailable"
        | "multiple_available_no_default";
      availableProviders: HostedPaymentProvider[];
    };

function normalizeConfiguredProvider(value: unknown): ConfiguredPaymentProvider {
  if (value === "stripe" || value === "eps") return value;
  return "none";
}

function normalizeAvailableProviders(values: readonly unknown[]): HostedPaymentProvider[] {
  const providers: HostedPaymentProvider[] = [];
  for (const value of values) {
    if ((value === "stripe" || value === "eps") && !providers.includes(value)) {
      providers.push(value);
    }
  }
  return providers;
}

export function resolveHostedPaymentProvider(input: {
  configuredDefaultProvider?: ConfiguredPaymentProvider | string | null;
  availableProviders: readonly (HostedPaymentProvider | string)[];
  explicitProvider?: HostedPaymentProvider | string | null;
}): HostedPaymentProviderResolution {
  const availableProviders = normalizeAvailableProviders(input.availableProviders);
  const explicitProvider = input.explicitProvider === "stripe" || input.explicitProvider === "eps"
    ? input.explicitProvider
    : null;

  if (explicitProvider) {
    return availableProviders.includes(explicitProvider)
      ? { provider: explicitProvider, reason: "explicit", availableProviders }
      : { provider: null, reason: "explicit_unavailable", availableProviders };
  }

  const configuredDefaultProvider = normalizeConfiguredProvider(input.configuredDefaultProvider);

  if (configuredDefaultProvider !== "none") {
    return availableProviders.includes(configuredDefaultProvider)
      ? { provider: configuredDefaultProvider, reason: "configured_default", availableProviders }
      : { provider: null, reason: "configured_default_unavailable", availableProviders };
  }

  if (availableProviders.length === 0) {
    return { provider: null, reason: "none_available", availableProviders };
  }

  if (availableProviders.length === 1) {
    return { provider: availableProviders[0], reason: "single_available_legacy", availableProviders };
  }

  return { provider: null, reason: "multiple_available_no_default", availableProviders };
}
