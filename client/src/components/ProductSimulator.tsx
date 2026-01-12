import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { ProductBuilderDraftState } from "@/hooks/useProductBuilderDraft";
import type { OptionSelection } from "@/features/quotes/editor/types";
import { ProductOptionsPanel } from "@/features/quotes/editor/components/ProductOptionsPanel";
import type { LineItemOptionSelectionsV2, OptionTreeV2 } from "@shared/optionTreeV2";
import { ProductOptionsPanelV2 } from "@/features/quotes/editor/components/ProductOptionsPanelV2";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";

type PricingPreviewState = "idle" | "loading" | "success" | "error";

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
}

function formulaNeedsP(formula: string): boolean {
  const f = String(formula || "");
  return /\b(p|pricePerSqft|unitPrice|price)\b/.test(f);
}

const ProductSimulator = ({
  draft,
  isDirty,
}: {
  draft: ProductBuilderDraftState<any>;
  isDirty?: boolean;
}) => {
  const [optionSelections, setOptionSelections] = useState<Record<string, OptionSelection>>({});
  const [optionSelectionsV2, setOptionSelectionsV2] = useState<LineItemOptionSelectionsV2>({ schemaVersion: 2, selected: {} });
  const [optionsV2Valid, setOptionsV2Valid] = useState(true);
  const { productDraft, pricingPreviewInputs, setPricingPreviewInputs } = draft;

  const options = (productDraft as any)?.optionsJson || [];
  const optionTreeJson = ((productDraft as any)?.optionTreeJson ?? null) as OptionTreeV2 | null;
  const isTreeV2 = Boolean(optionTreeJson && (optionTreeJson as any)?.schemaVersion === 2);

  const widthNumRaw = Number(pricingPreviewInputs.widthIn);
  const heightNumRaw = Number(pricingPreviewInputs.heightIn);
  const quantityNumRaw = Number(pricingPreviewInputs.quantity);

  const widthNum = Number.isFinite(widthNumRaw) ? widthNumRaw : 0;
  const heightNum = Number.isFinite(heightNumRaw) ? heightNumRaw : 0;
  const quantityNum = Number.isFinite(quantityNumRaw) ? quantityNumRaw : 0;

  const pricingProfileKey = String((productDraft as any)?.pricingProfileKey || "").trim();
  const pricingFormula = String((productDraft as any)?.pricingFormula || "").trim();
  const primaryMaterialIdRaw = (productDraft as any)?.primaryMaterialId;
  const primaryMaterialId = typeof primaryMaterialIdRaw === "string" && primaryMaterialIdRaw.trim() ? primaryMaterialIdRaw : null;

  const needsP = formulaNeedsP(pricingFormula);

  const selectionSignature = useMemo(() => {
    try {
      return JSON.stringify(isTreeV2 ? optionSelectionsV2 : optionSelections);
    } catch {
      return "{}";
    }
  }, [isTreeV2, optionSelections, optionSelectionsV2]);

  const draftSignature = useMemo(() => {
    // Keep this minimal: only fields that affect pricing computation.
    const p: any = productDraft as any;
    try {
      return JSON.stringify({
        pricingProfileKey: p?.pricingProfileKey ?? null,
        pricingFormula: p?.pricingFormula ?? null,
        pricingFormulaId: p?.pricingFormulaId ?? null,
        pricingProfileConfig: p?.pricingProfileConfig ?? null,
        primaryMaterialId: p?.primaryMaterialId ?? null,
        useNestingCalculator: p?.useNestingCalculator ?? null,
        sheetWidth: p?.sheetWidth ?? null,
        sheetHeight: p?.sheetHeight ?? null,
        materialType: p?.materialType ?? null,
        minPricePerItem: p?.minPricePerItem ?? null,
        optionsJson: p?.optionsJson ?? null,
        optionTreeJson: p?.optionTreeJson ?? null,
      });
    } catch {
      return "{}";
    }
  }, [productDraft]);

  const canSimulate =
    Boolean(pricingProfileKey) &&
    Boolean(pricingFormula) &&
    Number.isFinite(widthNum) &&
    widthNum > 0 &&
    Number.isFinite(heightNum) &&
    heightNum > 0 &&
    Number.isFinite(quantityNum) &&
    quantityNum > 0 &&
    (!needsP || Boolean(primaryMaterialId)) &&
    (!isTreeV2 || optionsV2Valid);

  const cantSimulateReason = useMemo(() => {
    if (!pricingProfileKey) return "Select a pricing profile to preview pricing.";
    if (!pricingFormula) return "Enter a pricing formula to preview pricing.";
    if (!Number.isFinite(widthNum) || widthNum <= 0) return "Enter a width and height to preview pricing.";
    if (!Number.isFinite(heightNum) || heightNum <= 0) return "Enter a width and height to preview pricing.";
    if (!Number.isFinite(quantityNum) || quantityNum <= 0) return "Enter a quantity to preview pricing.";
    if (needsP && !primaryMaterialId) return "Select a primary material (SqFt pricing) to preview pricing.";
    return "Enter size + qty to preview pricing.";
  }, [pricingProfileKey, pricingFormula, widthNum, heightNum, quantityNum, needsP, primaryMaterialId]);

  const debouncedInputs = useDebouncedValue(
    {
      width: widthNum,
      height: heightNum,
      quantity: quantityNum,
      selectionSignature,
      draftSignature,
    },
    250
  );

  const pricingQuery = useQuery({
    queryKey: [
      "productPricingSim",
      // Saved product id if present; otherwise stable "draft" bucket.
      String((productDraft as any)?.id ?? "draft"),
      pricingProfileKey,
      pricingFormula,
      primaryMaterialId ?? "no_material",
      debouncedInputs.width,
      debouncedInputs.height,
      debouncedInputs.quantity,
      debouncedInputs.selectionSignature,
      debouncedInputs.draftSignature,
    ],
    enabled: canSimulate,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      // How to test (Tree v2 MVP):
      // - Edit a product, set Options Mode = Tree v2, click Initialize Tree v2 (or paste schemaVersion=2 JSON)
      // - In the simulator, toggle root questions and verify optionsPrice changes in the result JSON
      if (!isTreeV2) {
        const response = await apiRequest("POST", "/api/quotes/calculate", {
          productId: (productDraft as any)?.id ?? undefined,
          productDraft,
          width: debouncedInputs.width,
          height: debouncedInputs.height,
          quantity: debouncedInputs.quantity,
          selectedOptions: optionSelections,
        });
        return await response.json();
      }

      const res = await fetch("/api/quotes/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          productId: (productDraft as any)?.id ?? undefined,
          productDraft,
          width: debouncedInputs.width,
          height: debouncedInputs.height,
          quantity: debouncedInputs.quantity,
          optionSelectionsJson: optionSelectionsV2,
        }),
      });

      if (res.ok) return await res.json();

      const text = await res.text();
      try {
        return { __httpError: { status: res.status, body: JSON.parse(text) } };
      } catch {
        return { __httpError: { status: res.status, body: { message: text || res.statusText } } };
      }
    },
  });

  const pricingState: PricingPreviewState = !canSimulate
    ? "idle"
    : pricingQuery.isFetching
      ? "loading"
      : pricingQuery.isError
        ? "error"
        : pricingQuery.data
          ? "success"
          : "loading";

  if (!productDraft) {
    return <div>Loading...</div>;
  }

  const httpError = (pricingQuery.data as any)?.__httpError as { status: number; body: any } | undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-semibold">{(productDraft as any).name}</div>
          {(productDraft as any).description ? (
            <div className="text-sm text-muted-foreground">{(productDraft as any).description}</div>
          ) : null}
        </div>
        {isDirty ? (
          <Badge variant="outline" className="text-[11px]">
            Unsaved changes
          </Badge>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label htmlFor="width">Width</Label>
          <Input
            id="width"
            type="number"
            value={pricingPreviewInputs.widthIn}
            onChange={(e) =>
              setPricingPreviewInputs({
                ...pricingPreviewInputs,
                widthIn: Number(e.target.value),
              })
            }
          />
        </div>
        <div>
          <Label htmlFor="height">Height</Label>
          <Input
            id="height"
            type="number"
            value={pricingPreviewInputs.heightIn}
            onChange={(e) =>
              setPricingPreviewInputs({
                ...pricingPreviewInputs,
                heightIn: Number(e.target.value),
              })
            }
          />
        </div>
        <div>
          <Label htmlFor="quantity">Quantity</Label>
          <Input
            id="quantity"
            type="number"
            value={pricingPreviewInputs.quantity}
            onChange={(e) =>
              setPricingPreviewInputs({
                ...pricingPreviewInputs,
                quantity: Number(e.target.value),
              })
            }
          />
        </div>
      </div>

      {isTreeV2 && optionTreeJson ? (
        <ProductOptionsPanelV2
          tree={optionTreeJson}
          selections={optionSelectionsV2}
          onSelectionsChange={setOptionSelectionsV2}
          onValidityChange={setOptionsV2Valid}
        />
      ) : (
        <ProductOptionsPanel
          product={productDraft}
          productOptions={options}
          optionSelections={optionSelections}
          onOptionSelectionsChange={setOptionSelections}
        />
      )}

      <div className="space-y-2">
        <div className="text-sm">
          <span className="font-medium">Pricing:</span>{" "}
          {!canSimulate
            ? "—"
            : pricingState === "loading"
              ? "Calculating…"
              : pricingState === "error"
                ? "Error"
                : "Ready"}
        </div>

        {!canSimulate ? (
          <div className="text-sm text-muted-foreground">{cantSimulateReason}</div>
        ) : null}

        {pricingQuery.isError ? (
          <div className="text-sm text-destructive">
            Pricing error: {pricingQuery.error instanceof Error ? pricingQuery.error.message : "Calculation failed"}
          </div>
        ) : null}

        {httpError ? (
          <div className="text-sm text-destructive">
            {typeof httpError?.body?.message === "string"
              ? httpError.body.message
              : `Pricing error (${httpError.status})`}
          </div>
        ) : null}

        {pricingQuery.data ? (
          <div className="text-sm">
            <div className="font-medium">Result</div>
            <pre className="mt-1 max-h-48 overflow-auto rounded border border-border/40 bg-card/50 p-2 text-xs">
              {JSON.stringify(pricingQuery.data, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ProductSimulator;
