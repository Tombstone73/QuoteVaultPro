import React from "react";
import { describe, expect, it } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";
import { PaymentProcessorSettingsCard } from "./PaymentProcessorSettingsCard";

(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;

const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");

describe("PaymentProcessorSettingsCard", () => {
  it("renders a constrained processor logo and default status in the header", () => {
    const html = renderToStaticMarkup(
      <PaymentProcessorSettingsCard
        processorName="Stripe"
        logoSrc="/assets/stripe-logo.png"
        logoAlt="Stripe"
        description="Card payments"
        status="ready"
        enabled={true}
        isDefault
        defaultExpanded
      >
        <div>Advanced credentials</div>
      </PaymentProcessorSettingsCard>,
    );

    expect(html).toContain('alt="Stripe"');
    expect(html).toContain('src="/assets/stripe-logo.png"');
    expect(html).toContain("max-h-10");
    expect(html).toContain("object-contain");
    expect(html).toContain("Default");
    expect(html).toContain("Advanced credentials");
  });

  it("hides advanced processor settings when collapsed", () => {
    const html = renderToStaticMarkup(
      <PaymentProcessorSettingsCard
        processorName="Enhanced Payment Systems"
        logoSrc="/assets/eps-logo.png"
        logoAlt="Enhanced Payment Systems"
        description="EPS hosted payments"
        status="needs_setup"
        enabled={false}
        isDefault={false}
      >
        <div>EPS API key</div>
      </PaymentProcessorSettingsCard>,
    );

    expect(html).toContain("Enhanced Payment Systems");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("EPS API key");
  });
});
