import type {
  CreateSalesWorkspaceInput,
  SalesWorkspace,
  SalesWorkspaceHeader,
  SalesWorkspaceLineInput,
  SalesWorkspaceMutation,
  SaveSalesWorkspaceInput,
  StartOrderEditWorkspaceInput,
  WorkspaceLine,
} from "../../src/modules/sales/workspaceContracts";
import type {
  PromoteSalesWorkspaceInput,
  WorkspacePromotionResult,
} from "../../src/modules/sales/workspacePromotion";
import type { SalesWorkspaceLineService } from "../../src/modules/sales/workspaceLines";
import type {
  WorkspaceArtworkClaim,
  WorkspaceArtworkMutation,
  WorkspaceArtworkResult,
} from "../../src/modules/artwork/workspaceArtwork";
import type { OrderEditArtworkIntentResult, OrderEditArtworkReference } from "../../src/modules/artwork/orderEditArtwork";
import type { SalesContactSelectionQuery, SalesContactSelectionResult } from "../../src/modules/customers/salesContactSelection";
import type { quoteApi, Selection } from "./api";

/** The wire keeps the owner's shape, without TypeScript-only ID brands. */
export type WorkspaceJson<T> = T extends { readonly __brand: string }
  ? T extends string ? string : T extends number ? number : never
  : T extends bigint ? string
  : T extends readonly (infer Item)[] ? readonly WorkspaceJson<Item>[]
  : T extends object ? { readonly [Key in keyof T]: WorkspaceJson<T[Key]> }
  : T;

export type WorkspaceView = WorkspaceJson<SalesWorkspace>;
export type WorkspaceHeader = WorkspaceJson<SalesWorkspaceHeader>;
export type WorkspaceLineView = WorkspaceJson<WorkspaceLine>;
export type WorkspaceLineInput = WorkspaceJson<SalesWorkspaceLineInput>;
export type WorkspacePromotionView = WorkspaceJson<WorkspacePromotionResult>;
export type WorkspaceConfigurationApi = Pick<typeof quoteApi, "configuration" | "resolveConfiguration" | "previewLinePricing">;
export type WorkspaceUpload = Omit<WorkspaceArtworkMutation, "workspaceId"> & Readonly<{ workspaceLineId?: string; file: File }>;
export type WorkspaceStartOrderEditInput = Pick<WorkspaceJson<StartOrderEditWorkspaceInput>, "requestId"> & Readonly<{ orderId: string }>;
export type WorkspaceEditArtworkReference = WorkspaceJson<OrderEditArtworkReference>;
export type WorkspaceEditArtworkIntent = SalesWorkspaceMutation & Readonly<{ sourceAssignmentId: string; action: "keep" | "remove" }>;

export interface SalesWorkspaceClient {
  create(organizationId: string, input: WorkspaceJson<CreateSalesWorkspaceInput>): Promise<WorkspaceView>;
  startOrderEdit?(organizationId: string, input: WorkspaceStartOrderEditInput): Promise<WorkspaceView>;
  read(organizationId: string, workspaceId: string): Promise<WorkspaceView>;
  list(organizationId: string): Promise<readonly WorkspaceView[]>;
  saveDraft(organizationId: string, workspaceId: string, input: WorkspaceJson<SaveSalesWorkspaceInput>): Promise<WorkspaceView>;
  addLine(organizationId: string, workspaceId: string, input: WorkspaceJson<Parameters<SalesWorkspaceLineService["add"]>[2]>): Promise<WorkspaceView>;
  updateLine(organizationId: string, workspaceId: string, input: WorkspaceJson<Parameters<SalesWorkspaceLineService["update"]>[2]>): Promise<WorkspaceView>;
  removeLine(organizationId: string, workspaceId: string, input: WorkspaceJson<Parameters<SalesWorkspaceLineService["remove"]>[2]>): Promise<WorkspaceView>;
  reorderLines(organizationId: string, workspaceId: string, input: WorkspaceJson<Parameters<SalesWorkspaceLineService["reorder"]>[2]>): Promise<WorkspaceView>;
  refreshLines(organizationId: string, workspaceId: string, input: WorkspaceJson<Parameters<SalesWorkspaceLineService["refresh"]>[2]>): Promise<WorkspaceView>;
  discard(organizationId: string, workspaceId: string, input: SalesWorkspaceMutation): Promise<WorkspaceView>;
  promote(organizationId: string, input: PromoteSalesWorkspaceInput): Promise<WorkspacePromotionView>;
  customers(organizationId: string, workspaceId: string, search: string): Promise<readonly Selection[]>;
  products(organizationId: string, workspaceId: string): Promise<readonly Selection[]>;
  contacts(organizationId: string, workspaceId: string, query: SalesContactSelectionQuery): Promise<SalesContactSelectionResult>;
  configurationApi(workspaceId: string): WorkspaceConfigurationApi;
  listArtwork(organizationId: string, workspaceId: string): Promise<readonly WorkspaceArtworkClaim[]>;
  uploadArtwork(organizationId: string, workspaceId: string, input: WorkspaceUpload): Promise<WorkspaceArtworkResult>;
  assignArtwork(organizationId: string, input: WorkspaceArtworkMutation & Readonly<{ claimId: string; workspaceLineId: string }>): Promise<WorkspaceArtworkResult>;
  removeArtwork(organizationId: string, input: WorkspaceArtworkMutation & Readonly<{ claimId: string }>): Promise<WorkspaceArtworkResult>;
  readEditRefs?(organizationId: string, workspaceId: string): Promise<readonly WorkspaceEditArtworkReference[]>;
  stageIntent?(organizationId: string, workspaceId: string, input: WorkspaceEditArtworkIntent): Promise<WorkspaceJson<OrderEditArtworkIntentResult>>;
}

/** Inject the existing authenticated V2 transport, including session-change checks. */
export type SalesWorkspaceTransport = Readonly<{
  request: <T>(url: string, init?: RequestInit) => Promise<T>;
  commandHeaders: (organizationId: string) => Readonly<Record<string, string>>;
}>;

export const createSalesWorkspaceClient = (transport: SalesWorkspaceTransport): SalesWorkspaceClient => {
  const endpoint = (organizationId: string, workspaceId?: string) =>
    `/v2/organizations/${encodeURIComponent(organizationId)}/sales-workspaces${workspaceId ? `/${encodeURIComponent(workspaceId)}` : ""}`;
  const command = <T>(organizationId: string, path: string, method: string, input: unknown) =>
    transport.request<T>(path, { method, headers: transport.commandHeaders(organizationId), body: JSON.stringify(input) });
  return {
    create: (org, input) => command(org, endpoint(org), "POST", input),
    startOrderEdit: (org, input) => command(org, `${endpoint(org)}/order-edits`, "POST", input),
    read: (org, id) => transport.request(endpoint(org, id)),
    list: (org) => transport.request(endpoint(org)),
    saveDraft: (org, id, input) => command(org, endpoint(org, id), "PATCH", input),
    addLine: (org, id, input) => command(org, `${endpoint(org, id)}/lines`, "POST", input),
    updateLine: (org, id, { lineId, ...input }) => command(org, `${endpoint(org, id)}/lines/${encodeURIComponent(lineId)}`, "PATCH", input),
    removeLine: (org, id, { lineId, ...input }) => command(org, `${endpoint(org, id)}/lines/${encodeURIComponent(lineId)}`, "DELETE", input),
    reorderLines: (org, id, input) => command(org, `${endpoint(org, id)}/lines/reorder`, "POST", input),
    refreshLines: (org, id, input) => command(org, `${endpoint(org, id)}/lines/refresh`, "POST", input),
    discard: (org, id, input) => command(org, `${endpoint(org, id)}/discard`, "POST", input),
    promote: (org, { workspaceId, ...input }) => command(org, `${endpoint(org, workspaceId)}/promote`, "POST", input),
    customers: (org, id, search) => transport.request(`${endpoint(org, id)}/customers?q=${encodeURIComponent(search)}`),
    products: (org, id) => transport.request(`${endpoint(org, id)}/products`),
    contacts: (org, id, input) => {
      const query = new URLSearchParams();
      if (input.customerId !== undefined) query.set("customerId", input.customerId);
      if (input.search !== undefined) query.set("search", input.search);
      if (input.limit !== undefined) query.set("limit", String(input.limit));
      if (input.selectedContactId !== undefined) query.set("selectedContactId", input.selectedContactId);
      return transport.request(`${endpoint(org, id)}/contacts${query.size ? `?${query}` : ""}`);
    },
    configurationApi: (id) => ({
      configuration: (org, productId) => transport.request(`${endpoint(org, id)}/products/${encodeURIComponent(productId)}/configuration`),
      resolveConfiguration: (org, productId, selections) => command(org, `${endpoint(org, id)}/products/${encodeURIComponent(productId)}/resolve`, "POST", { selections }),
      previewLinePricing: (org, productId, input) => command(org, `${endpoint(org, id)}/products/${encodeURIComponent(productId)}/preview`, "POST", input),
    }),
    listArtwork: (org, id) => transport.request(`${endpoint(org, id)}/artwork`),
    uploadArtwork: (org, id, input) => {
      const body = new FormData();
      body.append("requestId", input.requestId);
      body.append("expectedRevision", String(input.expectedRevision));
      if (input.workspaceLineId) body.append("workspaceLineId", input.workspaceLineId);
      body.append("file", input.file);
      return transport.request(`${endpoint(org, id)}/artwork`, { method: "POST", headers: transport.commandHeaders(org), body });
    },
    assignArtwork: (org, { workspaceId, claimId, ...input }) => command(org, `${endpoint(org, workspaceId)}/artwork/${encodeURIComponent(claimId)}/assign`, "POST", input),
    removeArtwork: (org, { workspaceId, claimId, ...input }) => command(org, `${endpoint(org, workspaceId)}/artwork/${encodeURIComponent(claimId)}`, "DELETE", input),
    readEditRefs: (org, id) => transport.request(`${endpoint(org, id)}/artwork-edit`),
    stageIntent: (org, id, input) => command(org, `${endpoint(org, id)}/artwork-edit`, "POST", input),
  };
};

export const salesWorkspaceKeys = {
  scope: (sessionScope: string, organizationId: string, userId: string) =>
    ["v2", sessionScope, organizationId, "sales-workspaces", userId] as const,
  workspace: (sessionScope: string, organizationId: string, userId: string, workspaceId: string) =>
    [...salesWorkspaceKeys.scope(sessionScope, organizationId, userId), "workspace", workspaceId] as const,
};

export const workspaceError = (error: unknown): Readonly<{ code: string; message: string; reason?: string }> => {
  if (error && typeof error === "object") {
    const value = error as { code?: unknown; message?: unknown; details?: { reason?: unknown } };
    return {
      code: typeof value.code === "string" ? value.code : "UNKNOWN",
      message: typeof value.message === "string" ? value.message : "The workspace request failed. Your local changes are retained.",
      ...(typeof value.details?.reason === "string" ? { reason: value.details.reason } : {}),
    };
  }
  return { code: "UNKNOWN", message: "The workspace request failed. Your local changes are retained." };
};
