import type { ProductionRunListItem } from "@/hooks/useProduction";

export function isProductionRunItem(value: unknown): value is ProductionRunListItem {
  return !!value && typeof value === "object" && (value as any).kind === "production_run";
}

export function productionRunToBoardItem(run: ProductionRunListItem): any {
  return {
    ...run,
    productionJobId: null,
    jobId: run.id,
    lineItemId: "",
    orderId: run.orderId ?? "",
    orderNumber: run.orderNumber,
    customerName: run.customerName,
    dueDate: null,
    qty: run.totalAllocatedQuantity,
    jobDescription: `${run.displayNumber} combined production run`,
    size: run.sheetWidth && run.sheetHeight ? `${run.sheetWidth} x ${run.sheetHeight}` : "—",
    sides: "—",
    media: `${run.memberCount} line items`,
    mediaLabel: `${run.memberCount} line items`,
    view: run.stationKey,
    stationKey: run.stationKey,
    stepKey: "production_run",
    startedAt: run.startedAt,
    completedAt: null,
    totalSeconds: 0,
    timer: { isRunning: false, runningSince: null, currentSeconds: 0 },
    reprintCount: 0,
    artwork: [],
    notes: [],
    productionFiles: run.files ?? [],
    productionAlerts: [],
    order: {
      id: run.orderId ?? "",
      customerId: run.customerId ?? "",
      orderNumber: run.orderNumber,
      customerName: run.customerName,
      dueDate: null,
      priority: "normal",
      lineItems: {
        count: run.memberCount,
        totalQuantity: run.totalAllocatedQuantity,
        primary: {
          id: run.members[0]?.orderLineItemId ?? "",
          description: run.members[0]?.description ?? "Combined run",
          quantity: run.totalAllocatedQuantity,
          width: null,
          height: null,
          materialId: null,
          materialName: null,
          productType: "Production Run",
          status: run.runStatus,
        },
        items: run.members.map((member) => ({
          id: member.orderLineItemId,
          description: `${member.orderNumber ? `Order ${member.orderNumber} - ` : ""}${member.description}`,
          quantity: member.allocatedQuantity,
          width: null,
          height: null,
          materialId: null,
          materialName: null,
          productType: "Production Run Member",
          status: run.runStatus,
        })),
      },
      artwork: [],
      productionFiles: run.files ?? [],
    },
  };
}
