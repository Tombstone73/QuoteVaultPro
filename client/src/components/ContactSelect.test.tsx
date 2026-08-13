import React from "react";
import { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, jest, test, beforeEach, afterEach } from "@jest/globals";
import { useQuery } from "@tanstack/react-query";
import { ContactSelect } from "./ContactSelect";

jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn(),
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

jest.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

jest.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <>{children}</>,
}));

jest.mock("@/components/ui/command", () => ({
  Command: ({ children }: any) => <div>{children}</div>,
  CommandGroup: ({ children, heading }: any) => (
    <section>
      <h3>{heading}</h3>
      {children}
    </section>
  ),
  CommandInput: React.forwardRef<HTMLInputElement, any>(({ onValueChange, ...props }, ref) => (
    <input
      ref={ref}
      {...props}
      onChange={(event) => onValueChange?.(event.currentTarget.value)}
    />
  )),
  CommandItem: ({ children, onSelect, ...props }: any) => (
    <div
      role="option"
      tabIndex={0}
      {...props}
      onClick={() => onSelect?.()}
      onKeyDown={(event) => {
        if (event.key === "Enter") onSelect?.();
      }}
    >
      {children}
    </div>
  ),
  CommandList: ({ children }: any) => <div>{children}</div>,
}));

const useQueryMock = jest.mocked(useQuery);

let container: HTMLDivElement;
let root: Root;

const contacts = [
  {
    id: "standalone-contact",
    customerId: null,
    firstName: "John",
    lastName: "Doe",
    email: "john@example.com",
    linkedCustomers: [],
    companyName: "Unlinked",
  },
  {
    id: "attached-contact",
    customerId: "customer-1",
    firstName: "Jane",
    lastName: "Smith",
    email: "jane@acme.example",
    companyName: "Acme Signs",
    customer: { id: "customer-1", companyName: "Acme Signs", status: "active" },
    linkedCustomers: [{ id: "customer-1", companyName: "Acme Signs", status: "active", isPrimary: true }],
  },
  {
    id: "other-customer-contact",
    customerId: "customer-2",
    firstName: "Other",
    lastName: "Customer",
    email: "other@example.com",
    companyName: "Other Signs",
    customer: { id: "customer-2", companyName: "Other Signs", status: "active" },
    linkedCustomers: [{ id: "customer-2", companyName: "Other Signs", status: "active", isPrimary: true }],
  },
];

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  useQueryMock.mockReset();
  useQueryMock.mockImplementation((options: any) => {
    const key = Array.isArray(options?.queryKey) ? options.queryKey : [];
    if (key[1] === "picker") {
      return { data: contacts, isLoading: false, isError: false } as any;
    }
    return { data: null, isLoading: false, isError: false } as any;
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderContactSelect(props: Partial<React.ComponentProps<typeof ContactSelect>> = {}) {
  const onChange = jest.fn();
  act(() => {
    root.render(
      <ContactSelect
        value={null}
        customerId={null}
        onChange={onChange}
        {...props}
      />,
    );
  });
  return { onChange };
}

describe("ContactSelect", () => {
  test("is a searchable combobox enabled without customerId", () => {
    renderContactSelect();
    expect(container.querySelector('[role="combobox"]')?.textContent).toContain("Search contacts");
    expect((container.querySelector("input") as HTMLInputElement)?.placeholder).toBe("Search by name, email, phone, or customer...");
    expect(useQueryMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });

  test("displays and selects standalone contacts by mouse", () => {
    const { onChange } = renderContactSelect();
    expect(container.textContent).toContain("John Doe");
    expect(container.textContent).toContain("No customer account - john@example.com");

    const option = Array.from(container.querySelectorAll('[role="option"]')).find((node) => node.textContent?.includes("John Doe"));
    expect(option).toBeTruthy();
    act(() => {
      Simulate.click(option as Element);
    });

    expect(onChange).toHaveBeenCalledWith("standalone-contact", expect.objectContaining({ id: "standalone-contact", customerId: null }));
  });

  test("supports keyboard selection", () => {
    const { onChange } = renderContactSelect();
    const option = Array.from(container.querySelectorAll('[role="option"]')).find((node) => node.textContent?.includes("Jane Smith"));
    expect(option).toBeTruthy();
    act(() => {
      Simulate.keyDown(option as Element, { key: "Enter" });
    });
    expect(onChange).toHaveBeenCalledWith("attached-contact", expect.objectContaining({ id: "attached-contact" }));
  });

  test("uses the tenant contact endpoint with the selected customer scope", async () => {
    let pickerOptions: any;
    useQueryMock.mockImplementation((options: any) => {
      const key = Array.isArray(options?.queryKey) ? options.queryKey : [];
      if (key[1] === "picker") {
        pickerOptions = options;
        return { data: [], isLoading: false, isError: false } as any;
      }
      return { data: null, isLoading: false, isError: false } as any;
    });
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ contacts: [] }) }));
    (globalThis as any).fetch = fetchMock;

    renderContactSelect({ customerId: "customer-1" });
    await act(async () => {
      await pickerOptions.queryFn();
    });

    const url = new URL(String(fetchMock.mock.calls[0][0]), "https://example.test");
    expect(url.searchParams.get("customerId")).toBe("customer-1");
    expect(url.searchParams.get("pageSize")).toBe("200");
  });

  test("never renders standalone or unrelated contacts in a selected customer's normal picker", () => {
    renderContactSelect({ customerId: "customer-1" });

    expect(container.textContent).toContain("Jane Smith");
    expect(container.textContent).not.toContain("John Doe");
    expect(container.textContent).not.toContain("Other Customer");
    expect(container.textContent).not.toContain("CONTACT_CUSTOMER_CONFLICT");
  });

  test("shows loading, empty, and error states", () => {
    useQueryMock.mockImplementation((options: any) => {
      const key = Array.isArray(options?.queryKey) ? options.queryKey : [];
      if (key[1] === "picker") return { data: [], isLoading: true, isError: false } as any;
      return { data: null, isLoading: false, isError: false } as any;
    });
    renderContactSelect();
    expect(container.textContent).toContain("Loading contacts...");

    useQueryMock.mockImplementation((options: any) => {
      const key = Array.isArray(options?.queryKey) ? options.queryKey : [];
      if (key[1] === "picker") return { data: [], isLoading: false, isError: false } as any;
      return { data: null, isLoading: false, isError: false } as any;
    });
    act(() => root.render(<ContactSelect value={null} customerId={null} onChange={jest.fn()} />));
    expect(container.textContent).toContain("No contacts found.");

    act(() => root.render(<ContactSelect value={null} customerId="customer-1" onChange={jest.fn()} />));
    expect(container.textContent).toContain("No contacts are linked to this customer.");

    useQueryMock.mockImplementation((options: any) => {
      const key = Array.isArray(options?.queryKey) ? options.queryKey : [];
      if (key[1] === "picker") return { data: [], isLoading: false, isError: true } as any;
      return { data: null, isLoading: false, isError: false } as any;
    });
    act(() => root.render(<ContactSelect value={null} customerId={null} onChange={jest.fn()} />));
    expect(container.textContent).toContain("Failed to search contacts. Try again.");
  });
});
