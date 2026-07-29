import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import { Form } from "@/components/ui/form";
import { ProductActiveStatusHeaderControl } from "./ProductActiveStatusHeaderControl";

jest.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, disabled, ...props }: any) => (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange(event.target.checked)}
      {...props}
    />
  ),
}));

type HarnessState = {
  isDirty: boolean;
  isActive: boolean;
};

function Harness({
  defaultActive,
  disabled = false,
  onState,
}: {
  defaultActive: boolean;
  disabled?: boolean;
  onState: (state: HarnessState) => void;
}) {
  const form = useForm({ defaultValues: { isActive: defaultActive } });
  const isActive = form.watch("isActive");

  React.useEffect(() => {
    onState({ isDirty: form.formState.isDirty, isActive });
  }, [form.formState.isDirty, isActive, onState]);

  return (
    <Form {...form}>
      <ProductActiveStatusHeaderControl control={form.control} disabled={disabled} />
      <button type="button" onClick={() => form.reset({ isActive: defaultActive })}>
        Discard
      </button>
    </Form>
  );
}

describe("ProductActiveStatusHeaderControl", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("shows active and inactive text while using normal form dirty/reset behavior", () => {
    const states: HarnessState[] = [];

    act(() => {
      root.render(<Harness defaultActive onState={(state) => states.push(state)} />);
    });

    expect(container.textContent).toContain("Active");
    const toggle = container.querySelector('input[aria-label="Product status Active"]') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(states.at(-1)).toMatchObject({ isDirty: false, isActive: true });

    act(() => {
      toggle.click();
    });

    expect(container.textContent).toContain("Inactive");
    expect(states.at(-1)).toMatchObject({ isDirty: true, isActive: false });

    const discard = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Discard")!;
    act(() => {
      discard.click();
    });

    expect(container.textContent).toContain("Active");
    expect(states.at(-1)).toMatchObject({ isDirty: false, isActive: true });
  });

  test("does not change while disabled for intake draft activation locks", () => {
    const states: HarnessState[] = [];

    act(() => {
      root.render(<Harness defaultActive={false} disabled onState={(state) => states.push(state)} />);
    });

    expect(container.textContent).toContain("Inactive");
    const toggle = container.querySelector('input[aria-label="Product status Inactive"]') as HTMLInputElement;
    expect(toggle.disabled).toBe(true);

    act(() => {
      toggle.click();
    });

    expect(states.at(-1)).toMatchObject({ isDirty: false, isActive: false });
  });
});
