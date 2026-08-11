import React from "react";
import { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { useQuery } from "@tanstack/react-query";
import { CustomerSelect } from "./CustomerSelect";

jest.mock("@tanstack/react-query", () => ({ useQuery: jest.fn() }));
jest.mock("@/components/ui/button", () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
jest.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <>{children}</>,
}));
jest.mock("@/components/ui/command", () => ({
  Command: ({ children }: any) => <div>{children}</div>,
  CommandEmpty: ({ children }: any) => <div>{children}</div>,
  CommandGroup: ({ children }: any) => <div>{children}</div>,
  CommandInput: React.forwardRef<HTMLInputElement, any>(({ onValueChange, ...props }, ref) => (
    <input ref={ref} {...props} onChange={(event) => onValueChange?.(event.currentTarget.value)} />
  )),
  CommandItem: ({ children, ...props }: any) => <div role="option" {...props}>{children}</div>,
  CommandList: React.forwardRef<HTMLDivElement, any>(({ children, ...props }, ref) => (
    <div ref={ref} data-command-list="true" {...props}>{children}</div>
  )),
}));

const useQueryMock = jest.mocked(useQuery);
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  useQueryMock.mockReset();
  useQueryMock.mockImplementation((options: any) => {
    const key = Array.isArray(options?.queryKey) ? options.queryKey : [];
    if (key[0] === "/api/customers" && typeof key[1] === "object") {
      return {
        data: [
          { id: "substring", companyName: "Metrographic Printing" },
          {
            id: "prefix",
            companyName: "Graphic Solutions",
            contacts: [
              { id: "contact-rick", firstName: "Rick", lastName: "Clark", isPrimary: false },
              { id: "contact-primary", firstName: "Pat", lastName: "Primary", isPrimary: true },
            ],
          },
        ],
        isLoading: false,
      } as any;
    }
    return { data: null, isLoading: false } as any;
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("CustomerSelect", () => {
  test("resets the list scroll position when the typed search query changes", () => {
    act(() => {
      root.render(<CustomerSelect value={null} onChange={jest.fn()} />);
    });

    const list = container.querySelector("[data-command-list]") as HTMLDivElement;
    const input = container.querySelector("input") as HTMLInputElement;
    list.scrollTop = 180;

    act(() => {
      input.value = "graphic";
      Simulate.change(input);
    });

    expect(list.scrollTop).toBe(0);
  });

  test("selects the linked contact that caused a customer search match", () => {
    const onChange = jest.fn();
    act(() => {
      root.render(<CustomerSelect value={null} onChange={onChange} />);
    });

    const input = container.querySelector("input") as HTMLInputElement;
    act(() => {
      input.value = "Rick Clark";
      Simulate.change(input);
    });

    const option = Array.from(container.querySelectorAll('[role="option"]'))
      .find((element) => element.textContent?.includes("Graphic Solutions")) as HTMLDivElement;
    act(() => {
      Simulate.select(option);
    });

    expect(onChange).toHaveBeenCalledWith("prefix", expect.objectContaining({ id: "prefix" }), "contact-rick");
  });
});
