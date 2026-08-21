import assert from "node:assert/strict";
import React from "react";
import { QueryClient } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ProductConfigurationFields,
  SellingPriceFields,
} from "./QuoteLineEditor";
import { SelectionField } from "./SelectionField";
import {
  orderApi,
  quoteApi,
  type ProductConfiguration,
  type QuoteLine,
  type QuoteResult,
} from "./api";
import {
  applyAuthoritativeQuoteResult,
  reconcileForbiddenQuoteMutation,
} from "./quoteCache";
import {
  applyServerConfiguration,
  applyDetectedArtworkDimensions,
  assessPersistedConfiguration,
  beginConfigurationSelectionResolution,
  changeDraftProduct,
  clearContactForCustomerChange,
  configurationInputSupported,
  draftFromQuoteLine,
  emptyQuoteLineDraft,
  markOverrideUnavailable,
  quoteLineInputFromDraft,
  sameEffectiveSelections,
  sellingInstructionFromDraft,
} from "./quoteFormModel";
import {
  quoteFormKeys,
  quoteFormQueryOptions,
  quoteKeys,
} from "./quoteFormQueries";
import { resolveTheme } from "./theme";

const dimensionalConfiguration: ProductConfiguration = {
  productId: "product-dimensional",
  displayName: "13oz Banner",
  measurementMode: "dimensions_required",
  requiresDimensions: true,
  supportedDimensionUnits: ["in"],
  effectiveSelections: { finish: "hemmed", grommets: "corners" },
  fields: [
    {
      selectionKey: "finish",
      label: "Finish",
      inputType: "select",
      required: true,
      choices: [
        { value: "raw", label: "Raw" },
        { value: "hemmed", label: "Hemmed" },
      ],
    },
    {
      selectionKey: "grommets",
      label: "Grommets",
      inputType: "select",
      required: false,
      choices: [
        { value: "none", label: "None" },
        { value: "corners", label: "Corners" },
      ],
    },
  ],
};

const quantityConfiguration: ProductConfiguration = {
  productId: "product-quantity",
  displayName: "Service fee",
  measurementMode: "quantity_only",
  requiresDimensions: false,
  supportedDimensionUnits: ["in"],
  effectiveSelections: { color: "black" },
  fields: [
    {
      selectionKey: "color",
      label: "Color",
      inputType: "select",
      required: true,
      choices: [{ value: "black", label: "Black" }],
    },
  ],
};

const persistedLine: QuoteLine = {
  lineId: "line-1",
  position: 1,
  productId: "product-dimensional",
  description: "Saved banner",
  quantity: 7,
  resolvedConfiguration: {
    schemaVersion: 1,
    selections: { finish: "raw", grommets: "none" },
    dimensions: { width: "24", height: "18.5", unit: "in" },
  },
  calculatedUnitAmount: { cents: 500, currency: "USD" },
  calculatedLineAmount: { cents: 3500, currency: "USD" },
  sellingUnitAmount: { cents: 450, currency: "USD" },
  sellingLineAmount: { cents: 3150, currency: "USD" },
  sellingPriceDecision: {
    kind: "total_override",
    reason: "Approved concession",
  },
};

const testQueryScopes = () => {
  assert.notDeepEqual(
    quoteFormKeys.customers("scope-a", "org-a"),
    quoteFormKeys.customers("scope-a", "org-b"),
  );
  assert.notDeepEqual(
    quoteFormKeys.products("scope-a", "org-a"),
    quoteFormKeys.products("scope-a", "org-b"),
  );
  assert.notDeepEqual(
    quoteFormKeys.contacts("scope-a", "org-a", "customer-a"),
    quoteFormKeys.contacts("scope-a", "org-a", "customer-b"),
  );
  assert.notDeepEqual(
    quoteFormKeys.configuration("scope-a", "org-a", "product-a"),
    quoteFormKeys.configuration("scope-a", "org-a", "product-b"),
  );
  assert.notDeepEqual(
    quoteKeys.quote("scope-a", "org-a", "quote-1"),
    quoteKeys.quote("scope-b", "org-b", "quote-1"),
  );
  assert.equal(quoteFormQueryOptions.contacts("scope-a", "org-a", "").enabled, false);
  assert.equal(quoteFormQueryOptions.configuration("", "org-a", "product-a").enabled, false);
};

const testSelectorsAndContactReset = () => {
  const customerMarkup = renderToStaticMarkup(
    <SelectionField
      label="Customer"
      value="customer-a"
      options={[{ customerId: "customer-a", displayName: "Acme" }]}
      identity="customerId"
      emptyLabel="Select Customer"
      onChange={() => undefined}
    />,
  );
  assert.match(customerMarkup, /aria-label="Customer"/);
  assert.match(customerMarkup, /value="customer-a" selected=""/);
  assert.match(customerMarkup, />Acme</);
  const contactMarkup = renderToStaticMarkup(
    <SelectionField
      label="Contact"
      value=""
      options={[]}
      identity="contactId"
      emptyLabel="Select Contact"
      disabled
      onChange={() => undefined}
    />,
  );
  assert.match(contactMarkup, /disabled=""/);
  assert.deepEqual(clearContactForCustomerChange("customer-b"), {
    customerId: "customer-b",
    contactId: "",
  });
};

const testCreateAndMeasurementPayloads = () => {
  let dimensionalDraft = changeDraftProduct(
    emptyQuoteLineDraft(),
    dimensionalConfiguration.productId,
  );
  dimensionalDraft = applyServerConfiguration(
    dimensionalDraft,
    dimensionalConfiguration,
  );
  dimensionalDraft = {
    ...dimensionalDraft,
    quantity: "2",
    dimensions: { width: "48", height: "24", unit: "in" },
  };
  const dimensionalInput = quoteLineInputFromDraft(
    dimensionalDraft,
    dimensionalConfiguration,
  );
  assert.deepEqual(dimensionalInput, {
    productId: "product-dimensional",
    quantity: 2,
    selections: { finish: "hemmed", grommets: "corners" },
    dimensions: { width: "48", height: "24", unit: "in" },
    selling: { kind: "calculated" },
  });

  let quantityDraft = changeDraftProduct(
    { ...dimensionalDraft, dimensions: { width: "99", height: "99", unit: "in" } },
    quantityConfiguration.productId,
  );
  quantityDraft = applyServerConfiguration(quantityDraft, quantityConfiguration);
  const quantityInput = quoteLineInputFromDraft(
    { ...quantityDraft, quantity: "4" },
    quantityConfiguration,
  );
  assert.equal("dimensions" in quantityInput, false);
  assert.equal(quantityInput.quantity, 4);
  assert.deepEqual(quantityInput.selections, { color: "black" });

  const dimensionalMarkup = renderToStaticMarkup(
    <ProductConfigurationFields
      configuration={dimensionalConfiguration}
      draft={dimensionalDraft}
      onSelection={() => undefined}
      onDimensions={() => undefined}
    />,
  );
  assert.match(dimensionalMarkup, /Width \(in\)/);
  assert.match(dimensionalMarkup, /Height \(in\)/);
  const quantityMarkup = renderToStaticMarkup(
    <ProductConfigurationFields
      configuration={quantityConfiguration}
      draft={quantityDraft}
      onSelection={() => undefined}
      onDimensions={() => undefined}
    />,
  );
  assert.doesNotMatch(quantityMarkup, /Width \(/);
  assert.doesNotMatch(quantityMarkup, /Height \(/);
};

const testDetectedArtworkDimensionsRespectManualIntent = () => {
  const blank = applyServerConfiguration(
    emptyQuoteLineDraft(),
    dimensionalConfiguration,
  );
  assert.deepEqual(
    applyDetectedArtworkDimensions(blank, dimensionalConfiguration, {
      widthIn: 24,
      heightIn: 18,
    })?.dimensions,
    { width: "24", height: "18", unit: "in" },
  );
  const manual = {
    ...blank,
    dimensions: { width: "30", height: "18", unit: "in" as const },
  };
  assert.equal(
    applyDetectedArtworkDimensions(manual, dimensionalConfiguration, {
      widthIn: 24,
      heightIn: 18,
    }),
    undefined,
    "detected artwork must not replace any manual dimension",
  );
};

const testPersistedLineAndDefinitionSafety = () => {
  const draft = draftFromQuoteLine(persistedLine);
  assert.equal(draft.productId, "product-dimensional");
  assert.equal(draft.quantity, "7");
  assert.deepEqual(draft.dimensions, {
    width: "24",
    height: "18.5",
    unit: "in",
  });
  assert.deepEqual(draft.selections, { finish: "raw", grommets: "none" });
  assert.deepEqual(draft.selling, {
    mode: "total_override",
    cents: "3150",
    reason: "Approved concession",
  });
  const editablePersistedConfiguration: ProductConfiguration = {
    ...dimensionalConfiguration,
    effectiveSelections: { finish: "raw", grommets: "none" },
  };
  const updateInput = quoteLineInputFromDraft(
    draft,
    editablePersistedConfiguration,
  );
  assert.deepEqual(updateInput.selections, {
    finish: "raw",
    grommets: "none",
  });
  assert.deepEqual(updateInput.dimensions, {
    width: "24",
    height: "18.5",
    unit: "in",
  });
  assert.deepEqual(updateInput.selling, {
    kind: "total_override",
    totalCents: 3150,
    reason: "Approved concession",
  });
  assert.equal(
    sameEffectiveSelections(draft.selections, {
      finish: "raw",
      grommets: "none",
    }),
    true,
  );
  assert.equal(
    sameEffectiveSelections(draft.selections, {
      finish: "raw",
      grommets: "none",
      newlyDefaulted: true,
    }),
    false,
    "new current defaults must not silently rewrite persisted Quote truth",
  );
  const changedProduct = changeDraftProduct(draft, "product-new");
  assert.deepEqual(changedProduct.selections, {});
  assert.equal(changedProduct.dimensions.width, "");
  assert.deepEqual(
    changedProduct.selling,
    draft.selling,
    "an explicit Product replacement must not silently discard the Sales-owned selling decision",
  );
};

const testServerResolutionRoundTrip = () => {
  const initial = applyServerConfiguration(
    changeDraftProduct(emptyQuoteLineDraft(), dimensionalConfiguration.productId),
    dimensionalConfiguration,
  );
  const hiddenResponse: ProductConfiguration = {
    ...dimensionalConfiguration,
    effectiveSelections: { finish: "raw" },
    fields: dimensionalConfiguration.fields.filter(
      (field) => field.selectionKey === "finish",
    ),
  };
  const firstRapidChange = beginConfigurationSelectionResolution(
    initial,
    "finish",
    "raw",
  );
  const secondRapidChange = beginConfigurationSelectionResolution(
    firstRapidChange.draft,
    "grommets",
    "none",
  );
  assert.deepEqual(secondRapidChange.requestedSelections, {
    finish: "raw",
    grommets: "none",
  });
  const hidden = applyServerConfiguration(initial, hiddenResponse);
  assert.deepEqual(hidden.selections, { finish: "raw" });
  assert.equal(
    hiddenResponse.fields.some((field) => field.selectionKey === "grommets"),
    false,
  );
  const visibleAgain = applyServerConfiguration(hidden, dimensionalConfiguration);
  assert.deepEqual(visibleAgain.selections, {
    finish: "hemmed",
    grommets: "corners",
  });

  const persisted = draftFromQuoteLine(persistedLine);
  const changedDefinition: ProductConfiguration = {
    ...dimensionalConfiguration,
    effectiveSelections: {
      finish: "raw",
      grommets: "none",
      newCurrentDefault: true,
    },
  };
  const assessment = assessPersistedConfiguration(
    persisted,
    changedDefinition,
  );
  assert.equal(assessment.compatible, false);
  assert.deepEqual(assessment.draft.selections, {
    finish: "raw",
    grommets: "none",
  });
  const explicitlyAdopted = applyServerConfiguration(
    assessment.draft,
    changedDefinition,
  );
  assert.deepEqual(explicitlyAdopted.selections, {
    finish: "raw",
    grommets: "none",
    newCurrentDefault: true,
  });
};

const testAuthoritativeQuoteAndForbiddenCacheTransitions = async () => {
  const queryClient = new QueryClient();
  const organizationId = "org-a";
  const quoteId = "quote-1";
  const authoritativeLine = {
    ...persistedLine,
    sellingUnitAmount: { cents: 600, currency: "USD" },
    sellingLineAmount: { cents: 4200, currency: "USD" },
  };
  const authoritativeResult = {
    quote: {
      quote: {
        quoteId,
        customerContact: { organizationId, customerId: "customer-a" },
        terms: {},
        currency: "USD",
        deliveryState: "not_sent",
        acceptanceState: "not_accepted",
        lines: [authoritativeLine],
      },
      number: { display: "Q-1", core: "1" },
      revision: "4",
      checkpoints: [],
      totals: {
        currency: "USD",
        calculatedLineAmount: { cents: 3500, currency: "USD" },
        sellingLineAmount: { cents: 4200, currency: "USD" },
      },
    },
  } as QuoteResult;
  applyAuthoritativeQuoteResult(
    queryClient,
    "scope-a",
    organizationId,
    authoritativeResult,
  );
  assert.equal(
    queryClient.getQueryData<QuoteResult["quote"]>(
      quoteKeys.quote("scope-a", organizationId, quoteId),
    )?.quote.lines[0]?.sellingLineAmount.cents,
    4200,
    "successful update must replace cached display state with the server projection",
  );
  queryClient.setQueryData(quoteKeys.bootstrap("scope-a", organizationId), {
    organizationId,
    csrfToken: "opaque",
    sessionScope: "scope-a",
    capabilities: { quoteOverridePrice: true },
  });
  await reconcileForbiddenQuoteMutation(queryClient, "scope-a", organizationId, quoteId);
  assert.equal(
    queryClient.getQueryData<{
      capabilities: { quoteOverridePrice: boolean };
    }>(quoteKeys.bootstrap("scope-a", organizationId))?.capabilities.quoteOverridePrice,
    false,
  );
  assert.equal(
    queryClient.getQueryState(quoteKeys.bootstrap("scope-a", organizationId))?.isInvalidated,
    true,
  );
  assert.equal(
    queryClient.getQueryState(quoteKeys.quote("scope-a", organizationId, quoteId))
      ?.isInvalidated,
    true,
    "a forbidden override must invalidate authoritative Quote state without writing false success",
  );
  queryClient.clear();
};

const testUnsupportedFieldFailsSafe = () => {
  assert.equal(configurationInputSupported("file"), false);
  const unsupported: ProductConfiguration = {
    ...quantityConfiguration,
    fields: [
      {
        selectionKey: "upload",
        label: "Upload",
        inputType: "file",
        required: true,
        choices: [],
      },
    ],
  };
  assert.throws(
    () =>
      quoteLineInputFromDraft(
        applyServerConfiguration(
          changeDraftProduct(emptyQuoteLineDraft(), unsupported.productId),
          unsupported,
        ),
        unsupported,
      ),
    /cannot edit safely/,
  );
  const markup = renderToStaticMarkup(
    <ProductConfigurationFields
      configuration={unsupported}
      draft={applyServerConfiguration(
        changeDraftProduct(emptyQuoteLineDraft(), unsupported.productId),
        unsupported,
      )}
      onSelection={() => undefined}
      onDimensions={() => undefined}
    />,
  );
  assert.match(markup, /unsupported/);
};

const testSellingPriceAndAuthority = () => {
  assert.deepEqual(
    sellingInstructionFromDraft({
      mode: "unit_override",
      cents: "425",
      reason: "Manager approved",
    }),
    { kind: "unit_override", unitCents: 425, reason: "Manager approved" },
  );
  assert.deepEqual(
    sellingInstructionFromDraft({
      mode: "total_override",
      cents: "3150",
      reason: "Approved concession",
    }),
    {
      kind: "total_override",
      totalCents: 3150,
      reason: "Approved concession",
    },
  );
  assert.throws(
    () =>
      sellingInstructionFromDraft({
        mode: "unit_override",
        cents: "4.25",
        reason: "invalid cents",
      }),
    /whole number of cents/,
  );
  const allowed = renderToStaticMarkup(
    <SellingPriceFields
      selling={{ mode: "calculated", cents: "", reason: "" }}
      canOverridePrice
      onChange={() => undefined}
    />,
  );
  assert.match(allowed, /Selling price decision/);
  assert.match(allowed, /Override unit price/);
  const denied = renderToStaticMarkup(
    <SellingPriceFields
      selling={draftFromQuoteLine(persistedLine).selling}
      canOverridePrice={false}
      onChange={() => undefined}
    />,
  );
  assert.match(denied, /visible but read-only/);
  assert.doesNotMatch(denied, /<select/);
  assert.equal(
    markOverrideUnavailable({
      organizationId: "org-a",
      csrfToken: "opaque",
      sessionScope: "scope-a",
      capabilities: { quoteOverridePrice: true },
    })?.capabilities.quoteOverridePrice,
    false,
    "a forbidden response must immediately reconcile stale override capability",
  );
};

const testTransportContracts = async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const data = url.endsWith("/ui-bootstrap")
      ? {
          organizationId: "org A",
          csrfToken: "csrf-token",
          sessionScope: "scope-a",
          capabilities: { quoteOverridePrice: true },
        }
      : url.endsWith("/configuration/resolve")
        ? dimensionalConfiguration
        : url.endsWith("/pricing-preview")
          ? { calculatedUnitAmount: { cents: 500, currency: "USD" }, calculatedLineAmount: { cents: 1000, currency: "USD" }, currency: "USD" }
        : url.endsWith("/orders")
          ? { order: { order: { lines: [] } }, draftInvoiceId: "invoice/1" }
        : [];
    return new Response(JSON.stringify({ ok: true, data }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await quoteApi.bootstrap("org A");
    await quoteFormQueryOptions.customers("scope-a", "org A").queryFn();
    await quoteFormQueryOptions.contacts("scope-a", "org A", "customer/1").queryFn();
    await quoteFormQueryOptions.products("scope-a", "org A").queryFn();
    await quoteFormQueryOptions.configuration("scope-a", "org A", "product/1").queryFn();
    await quoteApi.resolveConfiguration("org A", "product/1", {
      finish: "hemmed",
    });
    await quoteApi.previewLinePricing("org A", "product/1", {
      quantity: 2,
      selections: { finish: "hemmed", grommets: "corners" },
      dimensions: { width: "48", height: "24", unit: "in" },
    });
    const createLine = quoteLineInputFromDraft(
      {
        ...applyServerConfiguration(
          changeDraftProduct(
            emptyQuoteLineDraft(),
            dimensionalConfiguration.productId,
          ),
          dimensionalConfiguration,
        ),
        quantity: "2",
        dimensions: { width: "48", height: "24", unit: "in" },
      },
      dimensionalConfiguration,
    );
    await quoteApi.create("org A", "business-create-1", {
      customerContact: {
        organizationId: "org A",
        customerId: "customer/1",
      },
      lines: [createLine],
    });
    await orderApi.create("org A", "business-order-1", {
      customerContact: {
        organizationId: "org A",
        customerId: "customer/1",
      },
      lines: [{ ...createLine, clientLineKey: "line-artwork-1" }],
    });
    await quoteApi.patch("org A", "quote/1", "business-update-1", {
      expectedRevision: "3",
      lineChanges: [
        {
          kind: "update",
          lineId: "line-1",
          line: {
            ...createLine,
            selling: {
              kind: "unit_override",
              unitCents: 425,
              reason: "Manager approved",
            },
          },
        },
      ],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "/v2/organizations/org%20A/ui-bootstrap",
      "/v2/organizations/org%20A/quotes/form/customers",
      "/v2/organizations/org%20A/quotes/form/customers/customer%2F1/contacts",
      "/v2/organizations/org%20A/quotes/form/products",
      "/v2/organizations/org%20A/quotes/form/products/product%2F1/configuration",
      "/v2/organizations/org%20A/quotes/form/products/product%2F1/configuration/resolve",
      "/v2/organizations/org%20A/quotes/form/products/product%2F1/pricing-preview",
      "/v2/organizations/org%20A/quotes",
      "/v2/organizations/org%20A/orders",
      "/v2/organizations/org%20A/quotes/quote%2F1",
    ],
  );
  const resolveCall = calls.at(-5)!;
  assert.equal(resolveCall.init?.method, "POST");
  assert.equal(
    (resolveCall.init?.headers as Record<string, string>)["x-v2-csrf-token"],
    "csrf-token",
  );
  assert.equal(
    (resolveCall.init?.headers as Record<string, string>)["content-type"],
    "application/json",
    "a CSRF header must not replace the JSON content type",
  );
  assert.equal(resolveCall.init?.body, JSON.stringify({ selections: { finish: "hemmed" } }));
  const previewCall = calls.at(-4)!;
  assert.equal(previewCall.init?.method, "POST");
  assert.equal(
    (previewCall.init?.headers as Record<string, string>)["x-v2-csrf-token"],
    "csrf-token",
  );
  assert.deepEqual(JSON.parse(String(previewCall.init?.body)), {
    quantity: 2,
    selections: { finish: "hemmed", grommets: "corners" },
    dimensions: { width: "48", height: "24", unit: "in" },
  });
  const createBody = JSON.parse(String(calls.at(-3)!.init?.body));
  assert.equal(createBody.businessRequestId, "business-create-1");
  assert.deepEqual(createBody.lines[0].dimensions, {
    width: "48",
    height: "24",
    unit: "in",
  });
  assert.deepEqual(createBody.lines[0].selections, {
    finish: "hemmed",
    grommets: "corners",
  });
  const orderCall = calls.at(-2)!;
  assert.equal(orderCall.init?.method, "POST");
  assert.equal(
    (orderCall.init?.headers as Record<string, string>)["x-v2-csrf-token"],
    "csrf-token",
  );
  const orderBody = JSON.parse(String(orderCall.init?.body));
  assert.equal(orderBody.businessRequestId, "business-order-1");
  assert.deepEqual(orderBody.lines[0].selections, {
    finish: "hemmed",
    grommets: "corners",
  });
  assert.equal(orderBody.lines[0].clientLineKey, "line-artwork-1");
  const updateBody = JSON.parse(String(calls.at(-1)!.init?.body));
  assert.deepEqual(updateBody.lineChanges[0].line.selling, {
    kind: "unit_override",
    unitCents: 425,
    reason: "Manager approved",
  });
};

const testThemeRegression = () => {
  for (const themeId of ["printershero", "corporate", "industrial"] as const) {
    const theme = resolveTheme(
      themeId,
      themeId === "industrial" ? "dark" : "light",
    );
    for (const token of [
      theme.tokens.input,
      theme.tokens.border,
      theme.tokens.focus,
      theme.tokens.primary,
      theme.tokens.warning,
      theme.tokens.destructive,
    ])
      assert.match(token, /^(#|rgb|hsl)/i);
  }
};

const main = async () => {
  testQueryScopes();
  testSelectorsAndContactReset();
  testCreateAndMeasurementPayloads();
  testDetectedArtworkDimensionsRespectManualIntent();
  testPersistedLineAndDefinitionSafety();
  testServerResolutionRoundTrip();
  await testAuthoritativeQuoteAndForbiddenCacheTransitions();
  testUnsupportedFieldFailsSafe();
  testSellingPriceAndAuthority();
  await testTransportContracts();
  testThemeRegression();
  console.log("[v2-ui] Quote form integration tests passed");
};

await main();
