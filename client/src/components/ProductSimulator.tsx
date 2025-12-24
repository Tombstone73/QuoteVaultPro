import { useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import type { ProductBuilderDraftState } from "@/hooks/useProductBuilderDraft";
import type { OptionSelection } from "@/features/quotes/editor/types";
import { ProductOptionsPanel } from "@/features/quotes/editor/components/ProductOptionsPanel";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";

type PricingPreviewState = "idle" | "computing" | "success" | "error";

const ProductSimulator = ({
  draft,
  isDirty,
}: {
  draft: ProductBuilderDraftState<any>;
  isDirty?: boolean;
}) => {
  const [optionSelections, setOptionSelections] = useState<Record<string, OptionSelection>>({});
  const { productDraft, pricingPreviewInputs, setPricingPreviewInputs } = draft;

  const [pricingState, setPricingState] = useState<PricingPreviewState>("idle");
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [pricingResult, setPricingResult] = useState<any>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const debounceTimerRef = useRef<number | null>(null);

  const options = (productDraft as any)?.optionsJson || [];

  const inputsHash = useMemo(() => {
    return JSON.stringify({
      productId: (productDraft as any)?.id ?? null,
      width: pricingPreviewInputs.widthIn,
      height: pricingPreviewInputs.heightIn,
      quantity: pricingPreviewInputs.quantity,
      selectedOptions: optionSelections,
    });
  }, [productDraft, pricingPreviewInputs.widthIn, pricingPreviewInputs.heightIn, pricingPreviewInputs.quantity, optionSelections]);

  useEffect(() => {
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    // No product id (new/unsaved) => can't hit compute endpoint
    const productId = (productDraft as any)?.id as string | undefined;
    if (!productId) {
      setPricingState("idle");
      setPricingError(null);
      return;
    }

    const widthNum = Number(pricingPreviewInputs.widthIn) || 0;
    const heightNum = Number(pricingPreviewInputs.heightIn) || 0;
    const quantityNum = Number(pricingPreviewInputs.quantity) || 0;

    // Keep behavior fail-soft: if inputs are incomplete, don't compute.
    if (!Number.isFinite(quantityNum) || quantityNum <= 0) {
      setPricingState("idle");
      setPricingError(null);
      return;
    }

    // Debounce compute
    debounceTimerRef.current = window.setTimeout(() => {
      // Cancel previous request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      requestIdRef.current += 1;
      const requestId = requestIdRef.current;

      setPricingState("computing");
      // Keep last known result visible; clear error only on success

      apiRequest(
        "POST",
        "/api/quotes/calculate",
        {
          productId,
          width: widthNum,
          height: heightNum,
          quantity: quantityNum,
          selectedOptions: optionSelections,
        },
        { signal: controller.signal }
      )
        .then((r) => r.json())
        .then((data) => {
          if (requestId !== requestIdRef.current) return;
          setPricingResult(data);
          setPricingError(null);
          setPricingState("success");
        })
        .catch((err: any) => {
          if (err instanceof Error && err.name === "AbortError") return;
          if (requestId !== requestIdRef.current) return;
          setPricingError(err instanceof Error ? err.message : "Calculation failed");
          setPricingState("error");
        });
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputsHash]);

  if (!productDraft) {
    return <div>Loading...</div>;
  }

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

      <ProductOptionsPanel
        product={productDraft}
        productOptions={options}
        optionSelections={optionSelections}
        onOptionSelectionsChange={setOptionSelections}
      />

      <div className="space-y-2">
        <div className="text-sm">
          <span className="font-medium">Pricing:</span>{" "}
          {pricingState === "computing" ? "Computing…" : pricingState === "idle" ? "Idle" : "Ready"}
        </div>

        {pricingError ? (
          <div className="text-sm text-destructive">{pricingError}</div>
        ) : null}

        {pricingResult ? (
          <div className="text-sm">
            <div className="font-medium">Result</div>
            <pre className="mt-1 max-h-48 overflow-auto rounded border border-border/40 bg-card/50 p-2 text-xs">
              {JSON.stringify(pricingResult, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ProductSimulator;
