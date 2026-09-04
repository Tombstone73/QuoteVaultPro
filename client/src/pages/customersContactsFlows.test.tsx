import React from "react";
import { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, jest, test, beforeEach, afterEach } from "@jest/globals";
import ContactsPage from "./contacts";
import CustomersPage from "./customers";
import CustomerList from "@/components/CustomerList";
import { useContacts, useCreateContact, useDeleteContact, useUpdateContact } from "@/hooks/useContacts";
import { useQuery } from "@tanstack/react-query";

jest.mock("react-router-dom", () => ({
  Link: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a>,
  useNavigate: () => jest.fn(),
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { role: "admin" } }),
}));

jest.mock("@/hooks/useSmartBack", () => ({
  useSmartBack: () => ({ onSmartBack: jest.fn() }),
}));

jest.mock("@/hooks/useListViewSettings", () => ({
  useListViewSettings: () => ({
    columns: [
      { id: "firstName", label: "First Name", visible: true },
      { id: "lastName", label: "Last Name", visible: true },
      { id: "company", label: "Company", visible: true },
      { id: "email", label: "Email", visible: true },
      { id: "actions", label: "Actions", visible: true },
    ],
    toggleVisibility: jest.fn(),
    setColumnOrder: jest.fn(),
    setColumnWidth: jest.fn(),
  }),
}));

jest.mock("@/hooks/useContacts", () => ({
  useContacts: jest.fn(),
  useCreateContact: jest.fn(),
  useDeleteContact: jest.fn(),
  useUpdateContact: jest.fn(),
}));

jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn(),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
  useMutation: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock("@/components/list/ListViewSettings", () => ({
  ListViewSettings: () => <button type="button">Columns</button>,
}));

jest.mock("@/components/BackNavControls", () => () => <button type="button">Back</button>);
jest.mock("@/components/ContactFlagPill", () => ({ ContactFlagPill: () => null }));
jest.mock("@/components/customer-form", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/features/customers", () => ({
  EnhancedCustomerView: () => <div>Customer detail</div>,
}));

jest.mock("@/components/titan", () => ({
  Page: ({ children, maxWidth }: any) => <div data-max-width={maxWidth}>{children}</div>,
  PageHeader: ({ title, actions, backButton }: any) => (
    <header>
      {backButton}
      <h1>{title}</h1>
      {actions}
    </header>
  ),
  ContentLayout: ({ children, className }: any) => <main className={className}>{children}</main>,
  DataCard: ({ children, title, className }: any) => (
    <section className={className}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  ),
  StatusPill: ({ children }: any) => <span>{children}</span>,
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

jest.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

jest.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

jest.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, ...props }: any) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
      {...props}
    />
  ),
}));

jest.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children, disabled }: any) => (
    <select value={value} onChange={(event) => onValueChange(event.currentTarget.value)} disabled={disabled}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: ({ placeholder }: any) => <option value="">{placeholder}</option>,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <footer>{children}</footer>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

jest.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: any) => <div>{children}</div>,
  AlertDialogAction: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  AlertDialogCancel: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: any) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: any) => <footer>{children}</footer>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

jest.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuCheckboxItem: ({ children, checked, onCheckedChange, ...props }: any) => <label {...props}><input type="checkbox" checked={checked} onChange={(event) => onCheckedChange?.(event.currentTarget.checked)} />{children}</label>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  DropdownMenuLabel: ({ children }: any) => <span>{children}</span>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
}));

jest.mock("@/components/ui/table", () => ({
  Table: ({ children }: any) => <table>{children}</table>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableCell: ({ children, ...props }: any) => <td {...props}>{children}</td>,
  TableHead: ({ children, ...props }: any) => <th {...props}>{children}</th>,
  TableHeader: ({ children }: any) => <thead>{children}</thead>,
  TableRow: ({ children, ...props }: any) => <tr {...props}>{children}</tr>,
}));

jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

jest.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: any) => <span>{children}</span>,
  AvatarFallback: ({ children }: any) => <span>{children}</span>,
}));

const useContactsMock = jest.mocked(useContacts);
const useCreateContactMock = jest.mocked(useCreateContact);
const useDeleteContactMock = jest.mocked(useDeleteContact);
const useUpdateContactMock = jest.mocked(useUpdateContact);
const useQueryMock = jest.mocked(useQuery);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.localStorage.clear();

  useContactsMock.mockReturnValue({
    data: {
      contacts: [
        {
          id: "contact-1",
          customerId: "customer-1",
          firstName: "Ada",
          lastName: "Lovelace",
          title: null,
          email: "ada@example.com",
          phone: null,
          mobile: null,
          isPrimary: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          companyName: "Analytical Print",
          ordersCount: 0,
          quotesCount: 0,
          lastActivityAt: null,
        },
      ],
      total: 60,
      page: 1,
      pageSize: 50,
      totalPages: 2,
      hasNextPage: true,
      hasPreviousPage: false,
    },
    isLoading: false,
    error: null,
  } as any);

  useCreateContactMock.mockReturnValue({ mutateAsync: jest.fn(async () => ({})) } as any);
  useUpdateContactMock.mockReturnValue({ mutateAsync: jest.fn(async () => ({})) } as any);
  useDeleteContactMock.mockReturnValue({ mutateAsync: jest.fn(async () => ({})) } as any);
  useQueryMock.mockReturnValue({
    data: [
      { id: "customer-1", companyName: "Analytical Print" },
      { id: "customer-2", companyName: "Binary Signs" },
    ],
    isLoading: false,
  } as any);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.removeChild(container);
  jest.clearAllMocks();
});

test("Contacts pagination controls request the next backend page", () => {
  act(() => {
    root.render(<ContactsPage />);
  });

  const nextButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Next"));
  expect(nextButton).toBeTruthy();

  act(() => {
    nextButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  expect(useContactsMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 50 }));
});

test("Contacts exposes first-name and last-name backend sort controls", () => {
  act(() => {
    root.render(<ContactsPage />);
  });

  const firstNameHeader = Array.from(container.querySelectorAll("th")).find((header) => header.textContent?.includes("First Name"));
  const lastNameHeader = Array.from(container.querySelectorAll("th")).find((header) => header.textContent?.includes("Last Name"));
  expect(firstNameHeader).toBeTruthy();
  expect(lastNameHeader).toBeTruthy();

  act(() => {
    firstNameHeader?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  expect(useContactsMock).toHaveBeenLastCalledWith(expect.objectContaining({ sortBy: "firstName", sortDir: "asc" }));

  act(() => {
    lastNameHeader?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  expect(useContactsMock).toHaveBeenLastCalledWith(expect.objectContaining({ sortBy: "lastName", sortDir: "asc" }));
});

test("Contacts uses the full application workspace and removes the redundant list header", () => {
  act(() => {
    root.render(<ContactsPage />);
  });

  expect(container.querySelector('[data-max-width="full"]')).toBeTruthy();
  expect(container.textContent).not.toContain("All Contacts");
  expect(container.textContent).not.toContain("Search contacts by name, email, or company name");
  expect(container.querySelector("table")).toBeTruthy();
});

test("Contacts relationship filter changes the backend query identity and resets pagination", () => {
  act(() => {
    root.render(<ContactsPage />);
  });

  const nextButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Next"));
  act(() => {
    nextButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(useContactsMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, filter: undefined }));

  const relationshipSelect = Array.from(container.querySelectorAll("select")).find((select) =>
    Array.from(select.options).some((option) => option.value === "unlinked"),
  ) as HTMLSelectElement;
  expect(relationshipSelect).toBeTruthy();
  act(() => {
    relationshipSelect.value = "unlinked";
    relationshipSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });

  expect(useContactsMock).toHaveBeenLastCalledWith(expect.objectContaining({
    filter: "unlinked",
    page: 1,
    sortBy: "lastName",
    sortDir: "asc",
  }));
});

test("Contacts Add Contact flow renders and submits a company-linked payload", async () => {
  const createMutation = { mutateAsync: jest.fn(async () => ({ id: "new-contact" })) };
  useCreateContactMock.mockReturnValue(createMutation as any);

  await act(async () => {
    root.render(<ContactsPage />);
  });

  const addButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Add Contact"));
  expect(addButton).toBeTruthy();

  await act(async () => {
    addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  const select = Array.from(container.querySelectorAll("select")).find((candidate) =>
    Array.from(candidate.options).some((option) => option.value === "customer-2"),
  ) as HTMLSelectElement;
  const form = container.querySelector("form") as HTMLFormElement;
  const firstName = form.querySelector("#firstName") as HTMLInputElement;
  const lastName = form.querySelector("#lastName") as HTMLInputElement;

  await act(async () => {
    select.value = "customer-2";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await act(async () => {
    Simulate.change(firstName, { target: { value: "Grace" } } as any);
  });

  await act(async () => {
    Simulate.change(lastName, { target: { value: "Hopper" } } as any);
  });

  const submitButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Create Contact"));
  expect((submitButton as HTMLButtonElement | undefined)?.disabled).toBe(false);
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  expect(createMutation.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
    customerId: "customer-2",
    firstName: "Grace",
    lastName: "Hopper",
  }));
});

function mockCustomerListQuery() {
  useQueryMock.mockReturnValue({
    data: {
      customers: Array.from({ length: 20 }, (_, index) => ({
        id: `customer-${index + 1}`,
        companyName: `Customer ${index + 1}`,
        displayName: null,
        email: null,
        phone: null,
        status: "active",
        customerType: "business",
        currentBalance: "0",
        availableCredit: "0",
        createdAt: new Date().toISOString(),
        contacts: [],
      })),
      pagination: {
        page: 1,
        pageSize: 20,
        total: 35,
        totalPages: 2,
        hasNextPage: true,
        hasPreviousPage: false,
      },
    },
    isLoading: false,
    isFetching: false,
  } as any);
}

function getCustomerPageSizeSelect() {
  return Array.from(container.querySelectorAll("select")).find((select) =>
    Array.from(select.options).some((option) => option.textContent?.includes("50 / page")),
  ) as HTMLSelectElement | undefined;
}

function expectCustomerPaginationControls() {
  const listBody = container.querySelector('[data-testid="customer-list-body"]') as HTMLElement | null;
  expect(listBody).toBeTruthy();
  expect(listBody?.className).not.toContain("overflow-y-auto");
  expect(container.querySelector('[data-testid="customer-pagination-footer"]')).toBeTruthy();
  expect(container.textContent).toContain("Showing 1-20 of 35 customers");
  expect(container.textContent).toContain("20 / page");
  expect(container.textContent).toContain("50 / page");
  expect(container.textContent).toContain("100 / page");
}

test("Customers split mode defaults to 20 per page and shows reachable pagination controls", () => {
  mockCustomerListQuery();
  act(() => {
    root.render(
      <CustomerList
        selectedCustomerId={undefined}
        onSelectCustomer={jest.fn()}
        onNewCustomer={jest.fn()}
        search=""
        viewMode="split"
      />,
    );
  });

  const firstQueryArg = useQueryMock.mock.calls[0]?.[0] as any;
  expect(firstQueryArg.queryKey[1].pageSize).toBe(20);
  expectCustomerPaginationControls();
  expect(container.querySelectorAll('[data-testid="customer-list-body"] button')).toHaveLength(20);

  const nextButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Next"));
  act(() => {
    nextButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  const lastQueryArg = useQueryMock.mock.calls[useQueryMock.mock.calls.length - 1]?.[0] as any;
  expect(lastQueryArg.queryKey[1].page).toBe(2);
});

test("Customers enhanced mode grows with content and keeps pagination controls reachable", () => {
  mockCustomerListQuery();
  act(() => {
    root.render(
      <CustomerList
        selectedCustomerId={undefined}
        onSelectCustomer={jest.fn()}
        onNewCustomer={jest.fn()}
        search=""
        viewMode="enhanced"
      />,
    );
  });

  const firstQueryArg = useQueryMock.mock.calls[0]?.[0] as any;
  expect(firstQueryArg.queryKey[1]).toMatchObject({ viewMode: "enhanced", pageSize: 20 });
  expectCustomerPaginationControls();
  expect(container.querySelectorAll("tbody tr")).toHaveLength(20);

  const pageSizeSelect = getCustomerPageSizeSelect();
  expect(pageSizeSelect).toBeTruthy();

  act(() => {
    if (pageSizeSelect) {
      pageSizeSelect.value = "50";
      pageSizeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

  const lastQueryArg = useQueryMock.mock.calls[useQueryMock.mock.calls.length - 1]?.[0] as any;
  expect(lastQueryArg.queryKey[1].pageSize).toBe(50);
});

test("Customers enhanced page does not add a nested vertical scroll card when Contacts does not", () => {
  useContactsMock.mockClear();
  act(() => {
    root.render(<ContactsPage />);
  });

  const contactsCard = container.querySelector("table")?.closest("section") as HTMLElement | null;
  expect(contactsCard?.className).not.toContain("overflow-y-auto");

  useQueryMock.mockClear();
  mockCustomerListQuery();
  window.localStorage.setItem("titanos.customers.viewMode", "enhanced");
  act(() => {
    root.render(<CustomersPage />);
  });

  const listBody = container.querySelector('[data-testid="customer-list-body"]') as HTMLElement | null;
  const customerCard = listBody?.closest("section") as HTMLElement | null;

  expect(listBody).toBeTruthy();
  expect(listBody?.className).not.toContain("overflow-y-auto");
  expect(customerCard?.className).not.toContain("overflow-y-auto");
  expect(customerCard?.className).not.toContain("overflow-hidden");
  expect(customerCard?.className).not.toContain("h-[calc");
  expect(container.querySelectorAll("tbody tr")).toHaveLength(20);
  expect(container.querySelector('[data-testid="customer-pagination-footer"]')).toBeTruthy();
});

test("Customer list keeps financial columns hidden by default and persists an admin's column selection", () => {
  mockCustomerListQuery();
  act(() => {
    root.render(
      <CustomerList
        onSelectCustomer={jest.fn()}
        onNewCustomer={jest.fn()}
        search=""
        viewMode="enhanced"
        canManageCommercialConfiguration
        preferenceUserId="admin-1"
      />,
    );
  });

  expect(container.textContent).toContain("Columns");
  expect(container.querySelector("th")?.textContent).toContain("Company Name");
  expect(Array.from(container.querySelectorAll("th")).map((head) => head.textContent)).not.toContain("Terms");
  expect(Array.from(container.querySelectorAll("th")).map((head) => head.textContent)).not.toContain("Credit");

  const termsChoice = Array.from(container.querySelectorAll("label")).find((label) => label.textContent?.includes("Terms"));
  expect(termsChoice).toBeTruthy();
  act(() => {
    Simulate.change(termsChoice?.querySelector("input") as HTMLInputElement, { target: { checked: true } } as any);
  });

  expect(Array.from(container.querySelectorAll("th")).map((head) => head.textContent)).toContain("Terms");
  expect(window.localStorage.getItem("titanos.customers.listColumns.admin-1")).toContain("paymentTerms");
});

test("Customer list does not expose financial columns to lower-permission list users", () => {
  mockCustomerListQuery();
  act(() => {
    root.render(
      <CustomerList
        onSelectCustomer={jest.fn()}
        onNewCustomer={jest.fn()}
        search=""
        viewMode="enhanced"
        preferenceUserId="staff-1"
      />,
    );
  });

  expect(container.textContent).toContain("Columns");
  expect(container.textContent).not.toContain("Terms");
  expect(container.textContent).not.toContain("Credit");
});
