import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, jest, test } from "@jest/globals";
import { OrderDiscountInput } from "./OrderDiscountInput";

describe("New Order Totals discount input", () => {
    test("keeps one editable row and routes $ and % entries to the selected handler", () => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        const host = document.createElement("div");
        document.body.appendChild(host);
        const root = createRoot(host);
        const onAmount = jest.fn();
        const onPercent = jest.fn();
        const onMode = jest.fn();
        const render = (mode: "amount" | "percent", amount: number, percent: number) => act(() => root.render(
            <OrderDiscountInput mode={mode} amount={amount} percent={percent} maxAmount={500}
                onAmountChange={onAmount} onModeChange={onMode} onPercentChange={onPercent} />,
        ));
        const type = (input: HTMLInputElement, value: string) => act(() => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
            setter?.call(input, value);
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        try {
            render("amount", 0, 0);
            const select = host.querySelector('select[aria-label="Discount mode"]') as HTMLSelectElement;
            const input = host.querySelector('input[aria-label="Order discount"]') as HTMLInputElement;
            expect(select.value).toBe("amount");
            type(input, "50");
            expect(onAmount).toHaveBeenCalledWith(50);
            type(input, "999");
            expect(onAmount).toHaveBeenLastCalledWith(500);
            act(() => { select.value = "percent"; select.dispatchEvent(new Event("change", { bubbles: true })); });
            expect(onMode).toHaveBeenCalledWith("percent");
            render("percent", 50, 10);
            expect(input.value).toBe("10");
            type(input, "12.");
            expect(input.value).toBe("12.");
            type(input, "12.5");
            expect(onPercent).toHaveBeenCalledWith(12.5);
            expect(onAmount).toHaveBeenCalledTimes(2);
        } finally {
            act(() => root.unmount());
            host.remove();
        }
    });
});
