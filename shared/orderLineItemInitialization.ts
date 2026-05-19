import type { LineItemOptionSelectionsV2, OptionTreeV2 } from "./optionTreeV2";
import {
  buildPbv2DefaultSelections,
  getRenderablePbv2QuestionNodeIds,
  hasPbv2Selections,
} from "./pbv2OrderEntryRuntime";

type OrderEntryProductLike = {
  id: string;
  name?: string | null;
  requiresDesign?: boolean | null;
  productDesignRequiresDesign?: boolean | null;
  requiresPrepress?: boolean | null;
  productTypeRequiresPrepressOverride?: boolean | null;
  requiresProofApproval?: boolean | null;
  requiresProductionJob?: boolean | null;
  pbv2ActiveTreeVersionId?: string | null;
  optionTreeJson?: unknown;
  requiresDimensions?: boolean | null;
  pricingMode?: string | null;
};

export type InitialOrderLineItemDraft = {
  orderId: string;
  productId: string;
  productVariantId: null;
  description: string;
  width: number;
  height: number;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
  requiresDesign?: boolean;
  requiresPrepress?: boolean;
  requiresProofApproval: boolean;
  requiresProductionJob: boolean;
  optionSelectionsJson: LineItemOptionSelectionsV2 | null;
  specsJson: {
    notes: string;
    selectedOptions: unknown[];
    initialDraft: {
      requiresDesign?: boolean;
      requiresPrepress?: boolean;
      requiresProofApproval: boolean;
      requiresProductionJob: boolean;
      productRoutingDefaultsUsed: ProductRoutingDefaultsUsed;
      optionSelectionsJson: LineItemOptionSelectionsV2 | null;
      renderedOptionLabels: string[];
    };
  };
  debug: InitialOrderLineItemDraftDebug;
};

export type ProductRoutingDefaultsUsed = {
  requiresDesignSource: "productDesignConfig" | "unknown";
  requiresPrepressSource: "productTypeOverride" | "organizationDefault" | "unknown";
  requiresProofApprovalSource: "product";
  requiresProductionJobSource: "product";
};

export type InitialOrderLineItemDraftDebug = {
  productId: string;
  productName: string;
  requiresDesign?: boolean;
  requiresPrepress?: boolean;
  requiresProofApproval: boolean;
  requiresProductionJob: boolean;
  pbv2ActiveTreeVersionId: string | null;
  optionTreeJsonPresent: boolean;
  activeTreePresent: boolean;
  defaultSelectionsFound: boolean;
  sortedOptionLabels: string[];
  productRoutingDefaultsUsed: ProductRoutingDefaultsUsed;
  optionSelectionsJson: LineItemOptionSelectionsV2 | null;
};

function isDimensionRequired(product: OrderEntryProductLike): boolean {
  if (typeof product.requiresDimensions === "boolean") return product.requiresDimensions;
  if (product.pricingMode === "fee" || product.pricingMode === "addon" || product.pricingMode === "flat") return false;
  return true;
}

export function buildInitialOrderLineItemDraftFromProduct(
  product: OrderEntryProductLike,
  activeTree: OptionTreeV2 | null | undefined,
  orderId: string,
): InitialOrderLineItemDraft {
  const renderedNodeIds = getRenderablePbv2QuestionNodeIds(activeTree);
  const sortedOptionLabels = renderedNodeIds.map((nodeId) => {
    const label = activeTree?.nodes?.[nodeId]?.label;
    return String(label || nodeId);
  });
  const optionSelectionsJson = activeTree ? buildPbv2DefaultSelections(activeTree) : null;
  const requiresDesign =
    typeof product.requiresDesign === "boolean"
      ? product.requiresDesign
      : typeof product.productDesignRequiresDesign === "boolean"
        ? product.productDesignRequiresDesign
        : undefined;
  const requiresPrepress =
    typeof product.requiresPrepress === "boolean"
      ? product.requiresPrepress
      : typeof product.productTypeRequiresPrepressOverride === "boolean"
        ? product.productTypeRequiresPrepressOverride
        : undefined;
  const requiresProofApproval = product.requiresProofApproval === true;
  const requiresProductionJob = product.requiresProductionJob !== false;
  const productRoutingDefaultsUsed: ProductRoutingDefaultsUsed = {
    requiresDesignSource: typeof requiresDesign === "boolean" ? "productDesignConfig" : "unknown",
    requiresPrepressSource:
      typeof product.productTypeRequiresPrepressOverride === "boolean"
        ? "productTypeOverride"
        : typeof requiresPrepress === "boolean"
          ? "organizationDefault"
          : "unknown",
    requiresProofApprovalSource: "product",
    requiresProductionJobSource: "product",
  };

  const initialDraft = {
    ...(typeof requiresDesign === "boolean" ? { requiresDesign } : {}),
    ...(typeof requiresPrepress === "boolean" ? { requiresPrepress } : {}),
    requiresProofApproval,
    requiresProductionJob,
    productRoutingDefaultsUsed,
    optionSelectionsJson,
    renderedOptionLabels: sortedOptionLabels,
  };

  const debug: InitialOrderLineItemDraftDebug = {
    productId: product.id,
    productName: String(product.name || ""),
    requiresDesign,
    requiresPrepress,
    requiresProofApproval,
    requiresProductionJob,
    pbv2ActiveTreeVersionId: product.pbv2ActiveTreeVersionId ?? null,
    optionTreeJsonPresent: Boolean(product.optionTreeJson),
    activeTreePresent: Boolean(activeTree),
    defaultSelectionsFound: hasPbv2Selections(optionSelectionsJson),
    sortedOptionLabels,
    productRoutingDefaultsUsed,
    optionSelectionsJson,
  };

  return {
    orderId,
    productId: product.id,
    productVariantId: null,
    description: "",
    width: isDimensionRequired(product) ? 1 : 0,
    height: isDimensionRequired(product) ? 1 : 0,
    quantity: 1,
    unitPrice: "0.00",
    totalPrice: "0.00",
    ...(typeof requiresDesign === "boolean" ? { requiresDesign } : {}),
    ...(typeof requiresPrepress === "boolean" ? { requiresPrepress } : {}),
    requiresProofApproval,
    requiresProductionJob,
    optionSelectionsJson,
    specsJson: {
      notes: "",
      selectedOptions: [],
      initialDraft,
    },
    debug,
  };
}
