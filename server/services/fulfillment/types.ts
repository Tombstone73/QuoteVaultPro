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
  pickupTicketId?: string | null;
  shipmentId?: string | null;
  isArchived: boolean;
  archivedReason?: string | null;
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

export interface FulfillmentDetailDto extends QueueRowDto {
  customer: {
    name: string;
    email: string | null;
    phone: string | null;
  };
  lineItems: Array<{
    id: string;
    description: string | null;
    productType: string | null;
    quantity: number | null;
  }>;
  productionSummary: Array<{
    id: string;
    stationKey: string;
    stepKey: string;
    status: string;
    completedAt: string | null;
    assignedPrinterName: string | null;
  }>;
  pickupTicket: {
    id: string;
    status: string;
    readyAt: string | null;
    pickedUpAt: string | null;
    stagingLocation: string | null;
    pickupNotes: string | null;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
  } | null;
  shipments: Array<{
    id: string;
    status: string;
    carrier: string | null;
    serviceLevel: string | null;
    trackingNumber: string | null;
    shippedAt: string | null;
    updatedAt: string | null;
  }>;
  events: Array<{
    id: string;
    entityType: string;
    entityId: string;
    eventType: string;
    actorUserId: string | null;
    payloadJson: Record<string, any>;
    createdAt: string;
  }>;
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
