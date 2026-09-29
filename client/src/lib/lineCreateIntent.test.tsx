import React, { useRef, useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, expect, jest, test } from "@jest/globals";
import { LineCreateIntentStore, LineCreateSubmitGuard } from "./lineCreateIntent";

beforeAll(() => {
  let sequence = 0;
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: () => `123e4567-e89b-42d3-a456-${String(++sequence).padStart(12, "0")}` });
});

test("in-flight deliveries share one request; a new intentional add gets a new key", async () => {
  const store = new LineCreateIntentStore();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const send = jest.fn(async (_payload, key) => { await waiting; return { id: key }; });
  const first = store.run("add", { quantity: 1 }, send);
  const second = store.run("add", { quantity: 1 }, send);
  await Promise.resolve(); expect(send).toHaveBeenCalledTimes(1);
  release(); expect(await first).toEqual(await second);
  await store.run("add", { quantity: 1 }, send);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[0][1]).not.toEqual(send.mock.calls[1][1]);
});

test("an uncertain response retains the exact request key and original payload", async () => {
  const store = new LineCreateIntentStore();
  const send = jest.fn<(...args: any[]) => Promise<any>>().mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValue({ id: "canonical" });
  await expect(store.run("add", { quantity: 1 }, send)).rejects.toThrow();
  expect(store.payloadMatches("add", { quantity: 2 })).toBe(false);
  await store.run("add", { quantity: 2 }, send);
  expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
});

test.each([400, 401, 403, 404, 422])("confirmed %s rejection permits corrected retry", async (status) => {
  const store = new LineCreateIntentStore();
  const send = jest.fn<(...args: any[]) => Promise<any>>().mockRejectedValueOnce(new Error(`${status}: rejected`)).mockResolvedValue({ id: "canonical" });
  await expect(store.run("add", { quantity: 0 }, send)).rejects.toThrow();
  await store.run("add", { quantity: 1 }, send);
  expect(send.mock.calls[0][1]).not.toEqual(send.mock.calls[1][1]);
  expect(send.mock.calls[1][0]).toEqual({ quantity: 1 });
});

test("stale save/artwork callbacks reuse one local-line identity; Duplicate gets its own", async () => {
  const store = new LineCreateIntentStore();
  const send = jest.fn(async (_body, key) => ({ id: key }));
  const first = await store.run("line:temp-1", { quantity: 1 }, send, true);
  expect(await store.run("line:temp-1", { quantity: 1 }, send, true)).toEqual(first);
  const duplicate = await store.run("line:temp-2", { quantity: 1 }, send, true);
  expect(duplicate.id).not.toBe(first.id);
  expect(send).toHaveBeenCalledTimes(2);
});

function Harness({ send }: { send: () => Promise<void> }) {
  const guard = useRef(new LineCreateSubmitGuard());
  const [pending, setPending] = useState(false);
  const [rows, setRows] = useState(0);
  const submit = () => guard.current.run(async () => {
    setPending(true);
    try { await send(); setRows((n) => n + 1); }
    finally { setPending(false); }
  });
  return <form aria-label="line form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <button type="button" disabled={pending} onClick={() => { void submit(); }}>Add</button>
    <output>{rows} rows</output>
  </form>;
}

test("rapid clicks plus submit/Enter equivalent while unresolved produce one row", async () => {
  let finish!: () => void;
  const send = jest.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<Harness send={send} />); });
  const button = container.querySelector("button")!;
  await act(async () => {
    button.click(); button.click();
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(send).toHaveBeenCalledTimes(1);
  expect(button.disabled).toBe(true);
  await act(async () => { finish(); });
  expect(container.querySelector("output")!.textContent).toBe("1 rows");
  expect(button.disabled).toBe(false);
  await act(async () => { root.unmount(); }); container.remove();
});
