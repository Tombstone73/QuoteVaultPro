import { useEffect, useMemo, useState } from "react";
import { useWatch, type FieldValues, type UseFormReturn } from "react-hook-form";
import type { Material } from "@/hooks/useMaterials";
import type { PricingFormula } from "@/hooks/usePricingFormulas";

export type ProductBuilderPricingPreviewInputs = {
  widthIn: number;
  heightIn: number;
  quantity: number;
};

const PRODUCT_BUILDER_PREVIEW_STORAGE_KEY = "productBuilder.pricingPreviewInputs";

export type UseProductBuilderDraftArgs<TFormValues extends FieldValues> = {
  form: UseFormReturn<TFormValues>;
  materials?: Material[];
  pricingFormulas?: PricingFormula[];
};

export type ProductBuilderDraftState<TFormValues extends FieldValues> = {
  form: UseFormReturn<TFormValues>;

  // Draft snapshots for page-based builder + split preview.
  productDraft: TFormValues;
  optionsDraft: unknown;

  // Reference data.
  materials?: Material[];
  materialsById: Map<string, Material>;
  pricingFormulas?: PricingFormula[];

  // Local-only preview inputs. Not persisted.
  pricingPreviewInputs: ProductBuilderPricingPreviewInputs;
  setPricingPreviewInputs: (next: ProductBuilderPricingPreviewInputs) => void;
};

export function useProductBuilderDraft<TFormValues extends FieldValues>({
  form,
  materials,
  pricingFormulas,
}: UseProductBuilderDraftArgs<TFormValues>): ProductBuilderDraftState<TFormValues> {
  // react-hook-form typing can get tricky with generic useWatch; keep this hook permissive.
  const productDraft = useWatch({ control: form.control }) as TFormValues;
  const optionsDraft = useWatch({ control: form.control, name: "optionsJson" as any });

  const materialsById = useMemo(() => {
    const map = new Map<string, Material>();
    for (const material of materials ?? []) map.set(material.id, material);
    return map;
  }, [materials]);

  const [pricingPreviewInputs, setPricingPreviewInputs] = useState<ProductBuilderPricingPreviewInputs>(() => {
    const fallback: ProductBuilderPricingPreviewInputs = { widthIn: 24, heightIn: 36, quantity: 1 };
    try {
      const raw = localStorage.getItem(PRODUCT_BUILDER_PREVIEW_STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      const widthIn = Number(parsed?.widthIn);
      const heightIn = Number(parsed?.heightIn);
      const quantity = Number(parsed?.quantity);
      if (!Number.isFinite(widthIn) || widthIn <= 0) return fallback;
      if (!Number.isFinite(heightIn) || heightIn <= 0) return fallback;
      if (!Number.isFinite(quantity) || quantity <= 0) return fallback;
      return { widthIn, heightIn, quantity };
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(PRODUCT_BUILDER_PREVIEW_STORAGE_KEY, JSON.stringify(pricingPreviewInputs));
    } catch {
      // ignore
    }
  }, [pricingPreviewInputs]);

  // TODO(ProductBuilderPage): The split-screen pricing preview panel should subscribe to
  // `productDraft` + `optionsDraft` and recompute live as the draft changes.
  // Important: do NOT rely on modal open/close lifecycle for resetting this state.

  return {
    form,
    productDraft,
    optionsDraft,
    materials,
    materialsById,
    pricingFormulas,
    pricingPreviewInputs,
    setPricingPreviewInputs,
  };
}
