export type FulfillmentType = 'SHIP' | 'PICKUP';

export type DerivedOrderFulfillmentStatus =
  | 'READY'
  | 'PARTIAL'
  | 'SHIPPED';

export interface QueueRowDto {
  orderId: string;
  orderNumber: string;
  customerName: string;
  fulfillmentType: FulfillmentType;
  status: string;
  itemsRemaining: string;
  readySince: string | null;
  shipTo: string;
  overdue: boolean;
  productionJobs: Array<{
    id: string;
    lineItemId: string | null;
    quantity: number | null;
  }>;
  productionContext?: {
    primaryPrinterName: string | null;
    printerNames: string[];
    finishingRequirements: string[];
    lamination: string | null;
    registrationMarks: string[];
    productionNotes: string[];
    completedAt: string | null;
  };
}

export interface PaginationInput {
  page: number;
  pageSize: number;
}

export interface PaginationResult {
  page: number;
  pageSize: number;
  total: number;
}

export class FulfillmentHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'FulfillmentHttpError';
  }
}

export interface NotificationAttemptResult {
  notificationId: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  errorMessage?: string;
}
