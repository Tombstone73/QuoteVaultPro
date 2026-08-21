import React, { Fragment, useEffect, useRef, useState } from "react";
import {
  quoteApi,
  type ProductConfiguration,
  type SalesLinePricingPreview,
  type Selection,
} from "./api";
import {
  applyServerConfiguration,
  applyDetectedArtworkDimensions,
  assessPersistedConfiguration,
  beginConfigurationSelectionResolution,
  changeDraftProduct,
  configurationInputSupported,
  quoteLineInputFromDraft,
  type QuoteLineDraft,
  type QuoteLineMutationInput,
  type SellingDraft,
} from "./quoteFormModel";
import { useQuoteFormConfiguration } from "./quoteFormQueries";
import { SelectionField } from "./SelectionField";
import { ArtworkLineIntake, type DraftLineArtwork } from "./ArtworkLineIntake";

type EditorProps = Readonly<{
  organizationId: string;
  sessionScope: string;
  draftKey: string;
  initialDraft: QuoteLineDraft;
  initializeFromPersistedLine?: boolean;
  /** Existing routed Order lines retain their Product identity. */
  productEditable?: boolean;
  products: readonly Selection[];
  canOverridePrice: boolean;
  csrfReady: boolean;
  busy: boolean;
  submitLabel: string;
  onSubmit: (input: QuoteLineMutationInput, artwork: readonly DraftLineArtwork[]) => void;
  /** Only the shared pre-persistence Sales composer holds local Artwork files. */
  enableArtworkIntake?: boolean;
  onCancel?: () => void;
}>;

const selectionValue = (value: unknown): string =>
  value === undefined || value === null ? "" : String(value);

const choiceValue = (
  raw: string,
  choices: ProductConfiguration["fields"][number]["choices"],
): string | number | boolean =>
  choices.find((choice) => String(choice.value) === raw)?.value ?? raw;

export const ProductConfigurationFields = ({
  configuration,
  draft,
  onSelection,
  onDimensions,
}: Readonly<{
  configuration: ProductConfiguration;
  draft: QuoteLineDraft;
  onSelection: (key: string, value: unknown) => void;
  onDimensions: (value: QuoteLineDraft["dimensions"]) => void;
}>) => (
  <>
    {configuration.requiresDimensions && (
      <>
        <label className="field">
          Width ({draft.dimensions.unit})
          <input
            inputMode="decimal"
            value={draft.dimensions.width}
            onChange={(event) =>
              onDimensions({ ...draft.dimensions, width: event.target.value })
            }
          />
        </label>
        <label className="field">
          Height ({draft.dimensions.unit})
          <input
            inputMode="decimal"
            value={draft.dimensions.height}
            onChange={(event) =>
              onDimensions({ ...draft.dimensions, height: event.target.value })
            }
          />
        </label>
        <label className="field">
          Dimension unit
          <select
            value={draft.dimensions.unit}
            onChange={(event) =>
              onDimensions({
                ...draft.dimensions,
                unit: event.target.value as QuoteLineDraft["dimensions"]["unit"],
              })
            }
          >
            {configuration.supportedDimensionUnits.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </label>
      </>
    )}
    {configuration.fields.map((field) => {
      if (!configurationInputSupported(field.inputType))
        return (
          <div className="notice error" key={field.selectionKey} role="alert">
            {field.label} cannot be edited safely because its projected field type
            ({field.inputType}) is unsupported.
          </div>
        );
      const value = draft.selections[field.selectionKey];
      if (field.inputType === "boolean" && field.choices.length === 0)
        return (
          <label className="field checkbox-field" key={field.selectionKey}>
            <input
              type="checkbox"
              checked={value === true}
              onChange={(event) =>
                onSelection(field.selectionKey, event.target.checked)
              }
            />
            {field.label}
          </label>
        );
      if (field.inputType === "textarea")
        return (
          <label className="field" key={field.selectionKey}>
            {field.label}
            <textarea
              value={selectionValue(value)}
              onChange={(event) =>
                onSelection(field.selectionKey, event.target.value)
              }
            />
          </label>
        );
      if (field.inputType === "number" || field.inputType === "text")
        return (
          <label className="field" key={field.selectionKey}>
            {field.label}
            <input
              type={field.inputType}
              value={selectionValue(value)}
              onChange={(event) =>
                onSelection(
                  field.selectionKey,
                  field.inputType === "number"
                    ? Number(event.target.value)
                    : event.target.value,
                )
              }
            />
          </label>
        );
      if (field.inputType === "multiselect") {
        const selected = Array.isArray(value) ? value.map(String) : [];
        return (
          <label className="field" key={field.selectionKey}>
            {field.label}
            <select
              multiple
              value={selected}
              onChange={(event) =>
                onSelection(
                  field.selectionKey,
                  Array.from(event.target.selectedOptions).map((option) =>
                    choiceValue(option.value, field.choices),
                  ),
                )
              }
            >
              {field.choices.map((choice) => (
                <option key={String(choice.value)} value={String(choice.value)}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
        );
      }
      return (
        <label className="field" key={field.selectionKey}>
          {field.label}
          <select
            value={selectionValue(value)}
            onChange={(event) =>
              onSelection(
                field.selectionKey,
                choiceValue(event.target.value, field.choices),
              )
            }
          >
            <option value="">
              {field.required ? "Select required option" : "No selection"}
            </option>
            {field.choices.map((choice) => (
              <option key={String(choice.value)} value={String(choice.value)}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      );
    })}
  </>
);

export const SellingPriceFields = ({
  selling,
  canOverridePrice,
  onChange,
}: Readonly<{
  selling: SellingDraft;
  canOverridePrice: boolean;
  onChange: (value: SellingDraft) => void;
}>) => {
  const overridden = selling.mode !== "calculated";
  if (!canOverridePrice)
    return overridden ? (
      <div className="notice" data-readonly-override="true">
        Existing selling-price decision: {selling.mode.replaceAll("_", " ")}
        {selling.reason ? ` — ${selling.reason}` : ""}. It is visible but read-only
        for this permission set.
      </div>
    ) : null;
  if (selling.mode === "discount_preserved" || selling.mode === "locked_preserved")
    return (
      <div className="notice" data-readonly-override="true">
        Existing selling-price decision: {selling.mode.replace("_preserved", "")}. This
        established decision is preserved but is not an editable mode in this UI proof.
      </div>
    );
  return (
    <>
      <label className="field">
        Selling price
        <select
          aria-label="Selling price decision"
          value={selling.mode}
          onChange={(event) =>
            onChange({
              mode: event.target.value as SellingDraft["mode"],
              cents: "",
              reason: "",
            })
          }
        >
          <option value="calculated">Use calculated price</option>
          <option value="unit_override">Override unit price</option>
          <option value="total_override">Override line total</option>
        </select>
      </label>
      {selling.mode !== "calculated" && (
        <>
          <label className="field">
            {selling.mode === "unit_override"
              ? "Selling unit price (cents)"
              : "Selling line total (cents)"}
            <input
              type="number"
              min="0"
              step="1"
              value={selling.cents}
              onChange={(event) =>
                onChange({ ...selling, cents: event.target.value })
              }
            />
          </label>
          <label className="field">
            Override reason
            <input
              value={selling.reason}
              onChange={(event) =>
                onChange({ ...selling, reason: event.target.value })
              }
            />
          </label>
        </>
      )}
    </>
  );
};

export const QuoteLineEditor = ({
  organizationId,
  sessionScope,
  draftKey,
  initialDraft,
  initializeFromPersistedLine = false,
  productEditable = true,
  products,
  canOverridePrice,
  csrfReady,
  busy,
  submitLabel,
  onSubmit,
  enableArtworkIntake = false,
  onCancel,
}: EditorProps) => {
  const [draft, setDraft] = useState(initialDraft);
  const draftRef = useRef(initialDraft);
  const [configuration, setConfiguration] = useState<ProductConfiguration>();
  const [origin, setOrigin] = useState<"persisted" | "fresh">(
    initializeFromPersistedLine ? "persisted" : "fresh",
  );
  const [compatibilityWarning, setCompatibilityWarning] = useState("");
  const [localError, setLocalError] = useState("");
  const [resolving, setResolving] = useState(false);
  const [artwork, setArtwork] = useState<readonly DraftLineArtwork[]>([]);
  const [pricingPreview, setPricingPreview] = useState<SalesLinePricingPreview>();
  const [pricingPreviewError, setPricingPreviewError] = useState("");
  const pricingPreviewSequence = useRef(0);
  const appliedDefaults = useRef("");
  const validatedPersisted = useRef("");
  const resolutionSequence = useRef(0);
  const definition = useQuoteFormConfiguration(
    sessionScope,
    organizationId,
    draft.productId,
  );
  const replaceDraft = (
    value:
      | QuoteLineDraft
      | ((current: QuoteLineDraft) => QuoteLineDraft),
  ) => {
    const next =
      typeof value === "function" ? value(draftRef.current) : value;
    // The ref advances before React schedules its render so a second rapid event
    // composes against the first unsaved selection instead of a stale closure.
    draftRef.current = next;
    setDraft(next);
  };

  useEffect(() => {
    replaceDraft(initialDraft);
    setConfiguration(undefined);
    setOrigin(initializeFromPersistedLine ? "persisted" : "fresh");
    setCompatibilityWarning("");
    setLocalError("");
    setArtwork([]);
    setPricingPreview(undefined);
    setPricingPreviewError("");
    pricingPreviewSequence.current += 1;
    appliedDefaults.current = "";
    validatedPersisted.current = "";
    resolutionSequence.current += 1;
  }, [draftKey]);

  useEffect(() => {
    const projected = definition.data;
    if (!projected || projected.productId !== draft.productId) return;
    setConfiguration(projected);
    if (origin === "fresh") {
      const key = `${draftKey}:${draft.productId}`;
      if (appliedDefaults.current !== key) {
        appliedDefaults.current = key;
        replaceDraft((current) => applyServerConfiguration(current, projected));
      }
      return;
    }
    if (!csrfReady) return;
    const validationKey = `${draftKey}:${draft.productId}`;
    if (validatedPersisted.current === validationKey) return;
    validatedPersisted.current = validationKey;
    const sequence = ++resolutionSequence.current;
    const persistedDraft = draftRef.current;
    setResolving(true);
    void quoteApi
      .resolveConfiguration(organizationId, draft.productId, {
        ...persistedDraft.selections,
      })
      .then((resolved) => {
        if (resolutionSequence.current !== sequence) return;
        const assessment = assessPersistedConfiguration(
          persistedDraft,
          resolved,
        );
        setConfiguration(assessment.configuration);
        if (!assessment.compatible)
          setCompatibilityWarning(
            "The current Product definition resolves this line differently. The persisted Quote configuration remains unchanged until you explicitly adopt the current definition or change an option.",
          );
      })
      .catch(() => {
        if (resolutionSequence.current !== sequence) return;
        setCompatibilityWarning(
          "The persisted Quote configuration is not editable under the current Product definition. The existing commercial fact remains unchanged.",
        );
      })
      .finally(() => {
        if (resolutionSequence.current === sequence) setResolving(false);
      });
  }, [
    csrfReady,
    definition.data,
    draft.productId,
    draftKey,
    origin,
    organizationId,
  ]);

  useEffect(() => {
    if (!csrfReady || !configuration || !draft.productId) return;
    const quantity = Number(draft.quantity);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) return;
    if (configuration.requiresDimensions && (!draft.dimensions.width || !draft.dimensions.height)) return;
    const sequence = ++pricingPreviewSequence.current;
    const handle = globalThis.setTimeout(() => {
      void quoteApi.previewLinePricing(organizationId, draft.productId, {
        quantity,
        selections: { ...draft.selections },
        ...(configuration.requiresDimensions ? { dimensions: { ...draft.dimensions } } : {}),
      }).then((preview) => {
        if (pricingPreviewSequence.current !== sequence) return;
        setPricingPreview(preview);
        setPricingPreviewError("");
      }).catch((error: unknown) => {
        if (pricingPreviewSequence.current !== sequence) return;
        setPricingPreview(undefined);
        setPricingPreviewError(error instanceof Error ? error.message : "Pricing preview is unavailable.");
      });
    }, 200);
    return () => globalThis.clearTimeout(handle);
  }, [configuration, csrfReady, draft.dimensions, draft.productId, draft.quantity, draft.selections, organizationId]);

  const resolveSelection = (selectionKey: string, value: unknown) => {
    // An explicit operator selection supersedes the asynchronous persisted-line
    // compatibility assessment.  Without this, an assessment queued by the
    // initial definition load can arrive after the selection and restore the
    // historical value over the operator's current intent.
    validatedPersisted.current = `${draftKey}:${draftRef.current.productId}`;
    appliedDefaults.current = `${draftKey}:${draftRef.current.productId}`;
    setOrigin("fresh");
    const transition = beginConfigurationSelectionResolution(
      draftRef.current,
      selectionKey,
      value,
    );
    replaceDraft(transition.draft);
    const sequence = ++resolutionSequence.current;
    setResolving(true);
    setLocalError("");
    void quoteApi
      .resolveConfiguration(
        organizationId,
        transition.draft.productId,
        transition.requestedSelections,
      )
      .then((resolved) => {
        if (resolutionSequence.current !== sequence) return;
        setConfiguration(resolved);
        replaceDraft((current) => applyServerConfiguration(current, resolved));
        setOrigin("fresh");
        setCompatibilityWarning("");
      })
      .catch((error: unknown) => {
        if (resolutionSequence.current !== sequence) return;
        setLocalError(
          error instanceof Error
            ? error.message
            : "The server could not resolve this Product configuration.",
        );
      })
      .finally(() => {
        if (resolutionSequence.current === sequence) setResolving(false);
      });
  };

  const productChanged = (productId: string) => {
    resolutionSequence.current += 1;
    replaceDraft((current) => changeDraftProduct(current, productId));
    setConfiguration(undefined);
    setOrigin("fresh");
    setCompatibilityWarning("");
    setLocalError("");
    appliedDefaults.current = "";
  };

  const unavailableSellingDecision =
    draft.selling.mode === "locked_preserved" ||
    (!canOverridePrice && draft.selling.mode !== "calculated");
  const hasUnsupportedField = configuration?.fields.some(
    (field) => !configurationInputSupported(field.inputType),
  );
  const productOptions =
    draft.productId &&
    !products.some((product) => product.productId === draft.productId)
      ? [
          {
            productId: draft.productId,
            displayName:
              initialDraft.description || "Product retained on this Quote line",
          },
          ...products,
        ]
      : products;

  return (
    <div className="line-editor">
      <div className="grid">
        <SelectionField
          label="Product"
          value={draft.productId}
          options={productOptions}
          identity="productId"
          emptyLabel="Select Product"
          disabled={!productEditable}
          onChange={productChanged}
        />
        <label className="field">
          Quantity
          <input
            type="number"
            min="1"
            step="1"
            value={draft.quantity}
            onChange={(event) =>
              replaceDraft((current) => ({
                ...current,
                quantity: event.target.value,
              }))
            }
          />
        </label>
        {configuration && (
          <ProductConfigurationFields
            configuration={configuration}
            draft={draft}
            onSelection={resolveSelection}
            onDimensions={(dimensions) =>
              replaceDraft((current) => ({ ...current, dimensions }))
            }
          />
        )}
        {enableArtworkIntake && configuration && (
          <ArtworkLineIntake
            productionRequirements={configuration.productionRequirements}
            onChange={setArtwork}
            onDetectedDimensions={({ widthIn, heightIn }) => {
              const next = applyDetectedArtworkDimensions(
                draftRef.current,
                configuration,
                { widthIn, heightIn },
              );
              if (!next) return false;
              replaceDraft(next);
              return true;
            }}
          />
        )}
        <SellingPriceFields
          selling={draft.selling}
          canOverridePrice={canOverridePrice}
          onChange={(selling) =>
            replaceDraft((current) => ({ ...current, selling }))
          }
        />
      </div>
      {definition.isFetching && <div className="skeleton" />}
      {definition.isError && origin === "persisted" && (
        <div className="notice" role="alert">
          The current Product definition is unavailable. This Quote line’s persisted
          configuration remains visible and unchanged, but it cannot be repriced
          until an operator explicitly selects an available Product.
          <dl className="configuration-facts">
            {Object.entries(draft.selections).map(([key, value]) => (
              <Fragment key={key}>
                <dt>{key}</dt>
                <dd>{String(value)}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      )}
      {definition.isError && origin === "fresh" && (
        <div className="notice error" role="alert">
          The selected Product configuration is unavailable in this organization.
        </div>
      )}
      {compatibilityWarning && (
        <div className="notice" role="alert">
          <div>{compatibilityWarning}</div>
          <dl className="configuration-facts">
            {Object.entries(draft.selections).map(([key, value]) => (
              <Fragment key={key}>
                <dt>
                  {configuration?.fields.find(
                    (field) => field.selectionKey === key,
                  )?.label ?? key}
                </dt>
                <dd>{String(value)}</dd>
              </Fragment>
            ))}
          </dl>
          {definition.data && (
            <button
              className="button secondary inline-action"
              onClick={() => {
                replaceDraft((current) =>
                  applyServerConfiguration(current, definition.data!),
                );
                setConfiguration(definition.data);
                setOrigin("fresh");
                setCompatibilityWarning("");
                setLocalError("");
              }}
            >
              Explicitly use current Product configuration
            </button>
          )}
        </div>
      )}
      {localError && <div className="notice error">{localError}</div>}
      {pricingPreview && <div className="v2-sales-entry-price-preview" aria-live="polite">
        <p>Authoritative price preview: {(pricingPreview.calculatedLineAmount.cents / 100).toLocaleString(undefined, { style: "currency", currency: pricingPreview.currency })}</p>
        {pricingPreview.explanation.dimensions && <small>{pricingPreview.explanation.dimensions.widthIn} × {pricingPreview.explanation.dimensions.heightIn} in · {pricingPreview.explanation.dimensions.totalAreaSqft} sq ft total</small>}
        {pricingPreview.explanation.computedSheetUsage && <small>Computed sheet usage: {pricingPreview.explanation.computedSheetUsage.sheetCount} sheet{pricingPreview.explanation.computedSheetUsage.sheetCount === 1 ? "" : "s"}{pricingPreview.explanation.computedSheetUsage.billedSquareFeet == null ? "" : ` · ${pricingPreview.explanation.computedSheetUsage.billedSquareFeet} billable sq ft`}</small>}
        {pricingPreview.explanation.tier && <small>{pricingPreview.explanation.tier.basis === "computed_sheet" ? "Computed-sheet" : pricingPreview.explanation.tier.basis} tier · {pricingPreview.explanation.tier.value} · ${(pricingPreview.explanation.tier.rateCents / 100).toFixed(2)}/sq ft</small>}
        {pricingPreview.explanation.matrix && <small>Pricing matrix row: {pricingPreview.explanation.matrix.rowId}</small>}
        {pricingPreview.explanation.minimumChargeApplied && <small>Minimum charge applied</small>}
      </div>}
      {pricingPreviewError && <p className="notice error" role="alert">Pricing preview is unavailable: {pricingPreviewError}</p>}
      {unavailableSellingDecision && (
        <p className="muted">
          This line cannot be repriced without authority to preserve or replace its
          existing selling-price decision.
        </p>
      )}
      <div className="actions">
        <button
          className="button"
          disabled={
            busy ||
            resolving ||
            !csrfReady ||
            !configuration ||
            Boolean(compatibilityWarning) ||
            Boolean(localError) ||
            Boolean(hasUnsupportedField) ||
            unavailableSellingDecision
          }
          onClick={() => {
            try {
              setLocalError("");
              onSubmit(quoteLineInputFromDraft(draft, configuration!), artwork);
            } catch (error) {
              setLocalError(
                error instanceof Error ? error.message : "The line is invalid.",
              );
            }
          }}
        >
          {submitLabel}
        </button>
        {onCancel && (
          <button className="button secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
};

/** Shared Sales editor. The historical name remains as a compatibility export. */
export const SalesLineEditor = QuoteLineEditor;
