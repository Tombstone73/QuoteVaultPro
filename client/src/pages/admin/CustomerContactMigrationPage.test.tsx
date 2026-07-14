import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import CustomerContactMigrationPage, { getCustomerContactFinalizeState } from "./CustomerContactMigrationPage";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

let mockUser: any = { role: "admin", isPlatformAdmin: true, isPlatformDeveloper: true };
let mockIsLoading = false;
const toastMock: any = jest.fn();

const mockListPlatformSeedOrganizations: any = jest.fn();
const mockListCustomerContactMigrationBatches: any = jest.fn();
const mockGetCustomerContactMigrationBatch: any = jest.fn();
const mockFinalizeCustomerContactMigrationBatch: any = jest.fn();
const mockPlatformReauth: any = jest.fn();

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, isLoading: mockIsLoading }),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

jest.mock("@/pages/not-found", () => ({
  __esModule: true,
  default: () => <div>Not Found</div>,
}));

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}));

jest.mock("@/lib/api/platform", () => ({
  createCustomerContactMigrationBatch: jest.fn(),
  customerContactMigrationReportUrl: () => "#",
  finalizeCustomerContactMigrationBatch: (...args: any[]) => mockFinalizeCustomerContactMigrationBatch(...args),
  getCustomerContactMigrationBatch: (...args: any[]) => mockGetCustomerContactMigrationBatch(...args),
  getCustomerContactMigrationQuickBooksSourceStatus: jest.fn(async () => ({ httpStatus: 200, body: { success: true, data: null } })),
  listCustomerContactMigrationBatches: (...args: any[]) => mockListCustomerContactMigrationBatches(...args),
  listPlatformSeedOrganizations: () => mockListPlatformSeedOrganizations(),
  platformReauth: (...args: any[]) => mockPlatformReauth(...args),
  retrieveCustomerContactMigrationQuickBooksSource: jest.fn(),
  saveCustomerContactMigrationReviewDecision: jest.fn(),
  uploadCustomerContactMigrationQuickBooksSource: jest.fn(),
}));

const batch = {
  id: "batch_1",
  organizationId: "org_1",
  status: "ready_to_finalize",
  sourceLabel: "Test batch",
  summaryJson: {},
  createdAt: "2026-07-14T12:00:00.000Z",
  updatedAt: "2026-07-14T12:00:00.000Z",
};

function detail(overrides: Partial<typeof batch> = {}, remainingUnresolved = 0) {
  return {
    batch: { ...batch, ...overrides },
    companyRows: [],
    contactRows: [],
    relationshipRows: [],
    finalizePreview: {
      companiesToCreate: 292,
      companiesToUpdate: 0,
      contactsToCreate: 296,
      contactsToUpdate: 0,
      relationshipsToCreate: 288,
      relationshipsToUpdate: 0,
      remainingUnresolved,
    },
  };
}

function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(<CustomerContactMigrationPage />);
  });
  return { container, root: root! };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.includes(text)
  ) as HTMLButtonElement | undefined;
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}

function inputByPlaceholder(container: HTMLElement, placeholder: string): HTMLInputElement {
  const input = container.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement | null;
  if (!input) throw new Error(`Input not found: ${placeholder}`);
  return input;
}

function changeInput(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function loadReadyBatch(container: HTMLElement, batchDetail = detail()) {
  mockGetCustomerContactMigrationBatch.mockResolvedValueOnce({ httpStatus: 200, body: { success: true, data: batchDetail } });
  act(() => {
    buttonByText(container, "batch_1").click();
  });
  await flush();
}

beforeEach(() => {
  mockUser = { role: "admin", isPlatformAdmin: true, isPlatformDeveloper: true };
  mockIsLoading = false;
  toastMock.mockClear();
  mockListPlatformSeedOrganizations.mockResolvedValue({
    httpStatus: 200,
    body: { success: true, data: [{ id: "org_1", name: "Test Org", slug: "test-org", deleteState: "active", status: "active" }] },
  });
  mockListCustomerContactMigrationBatches.mockResolvedValue({ httpStatus: 200, body: { success: true, data: [batch] } });
  mockGetCustomerContactMigrationBatch.mockReset();
  mockFinalizeCustomerContactMigrationBatch.mockReset();
  mockPlatformReauth.mockReset();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("CustomerContactMigrationPage finalization", () => {
  test("missing confirmation text disables finalization with visible feedback", () => {
    const state = getCustomerContactFinalizeState({
      hasDetail: true,
      batchStatus: "ready_to_finalize",
      confirmationText: "",
      remainingUnresolved: 0,
      allowUnresolvedSkips: false,
      finalizing: false,
      hasOrganizationId: true,
    });

    expect(state.canSubmit).toBe(false);
    expect(state.visibleReason).toContain("Type FINALIZE exactly");
  });

  test("unresolved records require explicit skip approval before the button enables", () => {
    const state = getCustomerContactFinalizeState({
      hasDetail: true,
      batchStatus: "needs_review",
      confirmationText: "FINALIZE",
      remainingUnresolved: 37,
      allowUnresolvedSkips: false,
      finalizing: false,
      hasOrganizationId: true,
    });

    expect(state.canSubmit).toBe(false);
    expect(state.visibleReason).toContain("Approve unresolved skips");
  });

  test("non-finalizable batch status is displayed with required action", () => {
    const state = getCustomerContactFinalizeState({
      hasDetail: true,
      batchStatus: "failed",
      confirmationText: "FINALIZE",
      remainingUnresolved: 0,
      allowUnresolvedSkips: true,
      finalizing: false,
      hasOrganizationId: true,
    });

    expect(state.canSubmit).toBe(false);
    expect(state.visibleReason).toContain("Batch is in failed");
  });

  test("clicking enabled finalize opens step-up UI when authentication is required", async () => {
    const { container, root } = renderPage();
    await flush();
    await loadReadyBatch(container);
    changeInput(inputByPlaceholder(container, "Type FINALIZE"), "FINALIZE");
    mockFinalizeCustomerContactMigrationBatch.mockResolvedValueOnce({
      httpStatus: 401,
      body: { success: false, code: "STEP_UP_REQUIRED", message: "Step-up required" },
    });

    act(() => {
      buttonByText(container, "Finalize Import").click();
    });
    await flush();

    expect(mockFinalizeCustomerContactMigrationBatch).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Confirm your identity");
    expect(container.textContent).toContain("Finalizing this migration requires recent platform authentication.");

    act(() => root.unmount());
  });

  test("successful step-up resumes finalization automatically", async () => {
    const { container, root } = renderPage();
    await flush();
    await loadReadyBatch(container);
    changeInput(inputByPlaceholder(container, "Type FINALIZE"), "FINALIZE");
    mockFinalizeCustomerContactMigrationBatch
      .mockResolvedValueOnce({ httpStatus: 401, body: { success: false, code: "STEP_UP_REQUIRED" } })
      .mockResolvedValueOnce({
        httpStatus: 200,
        body: { success: true, data: { batch: { ...batch, status: "completed" }, counts: { newCompaniesCreated: 1, newContactsCreated: 2, relationshipsCreated: 3, rejectedRecords: 0, failedRecords: 0 } } },
      });
    mockPlatformReauth.mockResolvedValueOnce({ success: true });
    mockGetCustomerContactMigrationBatch.mockResolvedValueOnce({ httpStatus: 200, body: { success: true, data: detail({ status: "completed" }) } });

    act(() => {
      buttonByText(container, "Finalize Import").click();
    });
    await flush();
    changeInput(container.querySelector('input[type="password"]') as HTMLInputElement, "secret");
    act(() => {
      buttonByText(container, "Confirm").click();
    });
    await flush();

    expect(mockPlatformReauth).toHaveBeenCalledWith("secret");
    expect(mockFinalizeCustomerContactMigrationBatch).toHaveBeenCalledTimes(2);
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Import finalized" }));

    act(() => root.unmount());
  });

  test("backend validation error is visible to the user", async () => {
    const { container, root } = renderPage();
    await flush();
    await loadReadyBatch(container);
    changeInput(inputByPlaceholder(container, "Type FINALIZE"), "FINALIZE");
    mockFinalizeCustomerContactMigrationBatch.mockResolvedValueOnce({
      httpStatus: 409,
      body: { success: false, message: "Resolve remaining exceptions before finalizing." },
    });

    act(() => {
      buttonByText(container, "Finalize Import").click();
    });
    await flush();

    expect(container.textContent).toContain("Resolve remaining exceptions before finalizing.");
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Finalize failed", variant: "destructive" }));

    act(() => root.unmount());
  });

  test("successful finalization refreshes batches and shows a summary", async () => {
    const { container, root } = renderPage();
    await flush();
    await loadReadyBatch(container);
    changeInput(inputByPlaceholder(container, "Type FINALIZE"), "FINALIZE");
    mockFinalizeCustomerContactMigrationBatch.mockResolvedValueOnce({
      httpStatus: 200,
      body: { success: true, data: { batch: { ...batch, status: "completed" }, counts: { newCompaniesCreated: 4, newContactsCreated: 5, relationshipsCreated: 6, rejectedRecords: 7, failedRecords: 0 } } },
    });
    mockGetCustomerContactMigrationBatch.mockResolvedValueOnce({ httpStatus: 200, body: { success: true, data: detail({ status: "completed" }) } });

    act(() => {
      buttonByText(container, "Finalize Import").click();
    });
    await flush();

    expect(mockListCustomerContactMigrationBatches.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mockGetCustomerContactMigrationBatch).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Companies created 4");
    expect(container.textContent).toContain("relationships created 6");

    act(() => root.unmount());
  });

  test("duplicate click does not create duplicate finalization requests", async () => {
    const { container, root } = renderPage();
    await flush();
    await loadReadyBatch(container);
    changeInput(inputByPlaceholder(container, "Type FINALIZE"), "FINALIZE");
    let resolveFinalize: ((value: any) => void) | null = null;
    mockFinalizeCustomerContactMigrationBatch.mockReturnValueOnce(new Promise((resolve) => { resolveFinalize = resolve; }));

    act(() => {
      const button = buttonByText(container, "Finalize Import");
      button.click();
      button.click();
    });
    await flush();

    expect(mockFinalizeCustomerContactMigrationBatch).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Finalizing...");

    await act(async () => {
      resolveFinalize?.({ httpStatus: 200, body: { success: true, data: { batch, counts: {} } } });
    });

    act(() => root.unmount());
  });

  test("cancelled step-up produces visible feedback", async () => {
    const { container, root } = renderPage();
    await flush();
    await loadReadyBatch(container);
    changeInput(inputByPlaceholder(container, "Type FINALIZE"), "FINALIZE");
    mockFinalizeCustomerContactMigrationBatch.mockResolvedValueOnce({
      httpStatus: 401,
      body: { success: false, code: "STEP_UP_REQUIRED" },
    });

    act(() => {
      buttonByText(container, "Finalize Import").click();
    });
    await flush();
    act(() => {
      buttonByText(container, "Cancel").click();
    });
    await flush();

    expect(container.textContent).toContain("Step-up authentication was cancelled");
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Step-up cancelled", variant: "destructive" }));

    act(() => root.unmount());
  });
});
