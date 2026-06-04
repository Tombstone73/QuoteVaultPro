import React, { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, jest, test, beforeAll, beforeEach, afterEach } from "@jest/globals";

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: {
      id: "user_1",
      email: "dale@example.test",
      firstName: "Dale",
      lastName: "Cooper",
    },
  }),
}));

const toastMock = jest.fn();
jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children, className }: { children: React.ReactNode; className?: string }) => <h2 className={className}>{children}</h2>,
}));

jest.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  SelectValue: () => <span>Medium</span>,
}));

jest.mock("@/components/ui/radio-group", () => ({
  RadioGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  RadioGroupItem: ({ id }: { id: string }) => <input id={id} type="radio" readOnly />,
}));

let BugReportModal: typeof import("./BugReportModal").BugReportModal;
let validateScreenshotSelection: typeof import("./BugReportModal").validateScreenshotSelection;

beforeAll(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const module = await import("./BugReportModal");
  BugReportModal = module.BugReportModal;
  validateScreenshotSelection = module.validateScreenshotSelection;
});

beforeEach(() => {
  toastMock.mockClear();
  (global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/organization/current") {
      return responseJson({ id: "org_1", name: "Test Org", slug: "test-org" });
    }
    if (url === "/api/bug-reports/screenshot" && init?.method === "POST") {
      return responseJson({
        success: true,
        screenshotUrls: ["local:bug-screenshots/temp/screen-1.png", "local:bug-screenshots/temp/screen-2.png"],
        screenshotAttachments: [
          { filename: "screen-1.png", mimeType: "image/png", size: 1000, storagePath: "local:bug-screenshots/temp/screen-1.png", displayOrder: 0 },
          { filename: "screen-2.png", mimeType: "image/png", size: 2000, storagePath: "local:bug-screenshots/temp/screen-2.png", displayOrder: 1 },
        ],
      });
    }
    if (url === "/api/bug-reports" && init?.method === "POST") {
      return responseJson({ success: true, data: { id: "bug_1" } });
    }
    return responseJson({}, 404);
  }) as any;
  URL.createObjectURL = jest.fn(() => "blob:preview") as any;
  URL.revokeObjectURL = jest.fn() as any;
  Object.defineProperty(globalThis, "crypto", {
    value: { randomUUID: jest.fn(() => `uuid_${Math.random().toString(36).slice(2)}`) },
    configurable: true,
  });
});

afterEach(() => {
  delete (global as any).fetch;
});

function responseJson(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function file(name: string, size: number, type: string): File {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

function renderModal() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <BugReportModal open onClose={() => undefined} />
      </QueryClientProvider>,
    );
  });
  return { container, root };
}

function cleanup(root: Root, container: HTMLElement) {
  act(() => root.unmount());
  container.remove();
}

function attachViaInput(container: HTMLElement, files: File[]) {
  const input = container.querySelector("input[type='file']") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: files, configurable: true });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function fillRequiredFields(container: HTMLElement) {
  const title = container.querySelector("input[placeholder^='Brief summary']") as HTMLInputElement;
  const description = container.querySelector("textarea") as HTMLTextAreaElement;
  act(() => {
    Simulate.change(title, { target: { value: "Save button fails" } } as any);
    Simulate.change(description, { target: { value: "Clicking save leaves the quote page blank." } } as any);
  });
}

describe("BugReportModal screenshot attachments", () => {
  test("paste image attaches screenshot", () => {
    const { container, root } = renderModal();
    const pasted = file("snip.png", 1000, "image/png");
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        files: [],
        items: [{ kind: "file", type: "image/png", getAsFile: () => pasted }],
      },
    });

    act(() => {
      document.dispatchEvent(event);
    });

    expect(container.textContent).toContain("Attachments (1/5)");
    expect(container.querySelector("img[alt='Screenshot 1']")).not.toBeNull();
    cleanup(root, container);
  });

  test("drag/drop attaches screenshot", () => {
    const { container, root } = renderModal();
    const dropZone = container.textContent?.includes("Drop screenshots") ? container.querySelector(".border-dashed") as HTMLDivElement : container;
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [file("drop.png", 1000, "image/png")] } });

    act(() => {
      dropZone.dispatchEvent(event);
    });

    expect(container.textContent).toContain("Attachments (1/5)");
    cleanup(root, container);
  });

  test("upload attaches multiple screenshots", () => {
    const { container, root } = renderModal();
    attachViaInput(container, [
      file("one.png", 1000, "image/png"),
      file("two.jpg", 1000, "image/jpeg"),
    ]);

    expect(container.textContent).toContain("Attachments (2/5)");
    expect(container.querySelectorAll("img").length).toBe(2);
    cleanup(root, container);
  });

  test("remove screenshot works", () => {
    const { container, root } = renderModal();
    attachViaInput(container, [file("one.png", 1000, "image/png")]);

    act(() => {
      (container.querySelector("button[aria-label='Remove screenshot 1']") as HTMLButtonElement).click();
    });

    expect(container.textContent).toContain("Attachments (0/5)");
    expect(container.querySelectorAll("img").length).toBe(0);
    cleanup(root, container);
  });

  test("max 5 enforced", () => {
    const existing = Array.from({ length: 5 }, (_, index) => file(`screen-${index}.png`, 1000, "image/png"));
    expect(validateScreenshotSelection(existing, [file("extra.png", 1000, "image/png")])).toContain("up to 5");
  });

  test("max file size enforced", () => {
    expect(validateScreenshotSelection([], [file("huge.png", 10 * 1024 * 1024 + 1, "image/png")])).toContain("10 MB or smaller");
  });

  test("total size enforced", () => {
    expect(validateScreenshotSelection(
      [
        file("a.png", 9 * 1024 * 1024, "image/png"),
        file("b.png", 9 * 1024 * 1024, "image/png"),
      ],
      [file("c.png", 8 * 1024 * 1024, "image/png")],
    )).toContain("total limit is 25 MB");
  });

  test("non-image files rejected", () => {
    expect(validateScreenshotSelection([], [file("notes.txt", 1000, "text/plain")])).toContain("Only image files");
  });

  test("bug report submits all screenshot metadata", async () => {
    const { container, root } = renderModal();
    fillRequiredFields(container);
    attachViaInput(container, [
      file("one.png", 1000, "image/png"),
      file("two.png", 2000, "image/png"),
    ]);

    await act(async () => {
      (container.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    const createCall = ((global as any).fetch as jest.Mock).mock.calls.find((call) => call[0] === "/api/bug-reports");
    expect(createCall).toBeDefined();
    const payload = JSON.parse((createCall?.[1] as RequestInit).body as string);
    expect(payload.screenshotAttachments).toHaveLength(2);
    expect(payload.screenshotAttachments[0]).toEqual(expect.objectContaining({
      filename: "screen-1.png",
      mimeType: "image/png",
      size: 1000,
      storagePath: "local:bug-screenshots/temp/screen-1.png",
      displayOrder: 0,
    }));
    expect(payload.screenshotUrls).toEqual([
      "local:bug-screenshots/temp/screen-1.png",
      "local:bug-screenshots/temp/screen-2.png",
    ]);
    expect(payload.metadata.autoContext.user.email).toBe("dale@example.test");
    cleanup(root, container);
  });
});
