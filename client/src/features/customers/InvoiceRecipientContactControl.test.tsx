import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InvoiceRecipientContactControl } from "./InvoiceRecipientContactControl";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("InvoiceRecipientContactControl", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderControl(overrides: Partial<ComponentProps<typeof InvoiceRecipientContactControl>> = {}) {
    const props = {
      contactId: "contact-1",
      contactName: "Jessica Selzer",
      email: "jessica@example.com",
      checked: false,
      pending: false,
      onCheckedChange: jest.fn(),
      ...overrides,
    };
    act(() => root.render(<InvoiceRecipientContactControl {...props} />));
    return props;
  }

  test("is directly visible and reflects saved isBilling state", () => {
    renderControl({ checked: true });

    expect(container.textContent).toContain("Receives Invoices");
    expect(container.querySelector('[role="checkbox"]')?.getAttribute("data-state")).toBe("checked");
  });

  test("toggles independently without triggering row navigation", () => {
    const onCheckedChange = jest.fn();
    const navigate = jest.fn();
    act(() => root.render(
      <div onClick={navigate}>
        <InvoiceRecipientContactControl
          contactId="contact-1"
          contactName="Jessica Selzer"
          email="jessica@example.com"
          checked={false}
          pending={false}
          onCheckedChange={onCheckedChange}
        />
        <InvoiceRecipientContactControl
          contactId="contact-2"
          contactName="Katie Kistler"
          email="katie@example.com"
          checked
          pending={false}
          onCheckedChange={jest.fn()}
        />
      </div>,
    ));

    const controls = container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]');
    expect(controls[0]?.getAttribute("data-state")).toBe("unchecked");
    expect(controls[1]?.getAttribute("data-state")).toBe("checked");
    act(() => controls[0]?.click());

    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(navigate).not.toHaveBeenCalled();
    expect(controls[1]?.getAttribute("data-state")).toBe("checked");
  });

  test("prevents selecting a contact without a usable email", () => {
    const props = renderControl({ email: null });
    const checkbox = container.querySelector<HTMLButtonElement>('[role="checkbox"]');

    expect(checkbox?.disabled).toBe(true);
    expect(container.textContent).toContain("Email required");
    act(() => checkbox?.click());
    expect(props.onCheckedChange).not.toHaveBeenCalled();
  });

  test("allows an invalid historical selection to be switched off", () => {
    const props = renderControl({ email: "", checked: true });
    const checkbox = container.querySelector<HTMLButtonElement>('[role="checkbox"]');

    expect(checkbox?.disabled).toBe(false);
    act(() => checkbox?.click());
    expect(props.onCheckedChange).toHaveBeenCalledWith(false);
  });

  test("disables the control while its save is pending", () => {
    const props = renderControl({ pending: true });
    const checkbox = container.querySelector<HTMLButtonElement>('[role="checkbox"]');

    expect(checkbox?.disabled).toBe(true);
    expect(container.querySelector('[aria-label="Saving invoice recipient"]')).toBeTruthy();
    act(() => checkbox?.click());
    expect(props.onCheckedChange).not.toHaveBeenCalled();
  });
});
