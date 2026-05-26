import { formatProductionDocumentNumber, type ProductionDocumentNumberDisplayMode } from "@shared/documentNumbering";

export function getProductionOrderNumber(
  job: {
    orderNumber?: string | null;
    displayNumber?: string | null;
    numberCore?: number | null;
    order?: {
      orderNumber?: string | null;
      displayNumber?: string | null;
      numberCore?: number | null;
    } | null;
  },
  mode: ProductionDocumentNumberDisplayMode = "full",
): string {
  return formatProductionDocumentNumber({
    displayNumber: job.order?.displayNumber ?? job.displayNumber,
    numberCore: job.order?.numberCore ?? job.numberCore,
    legacyNumber: job.order?.orderNumber ?? job.orderNumber,
    mode,
  }) || "";
}
