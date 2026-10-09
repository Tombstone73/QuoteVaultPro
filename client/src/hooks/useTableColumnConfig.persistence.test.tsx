import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useTableColumnConfig, type ColumnConfig } from "./useTableColumnConfig";

const defaults: ColumnConfig[] = [
  { id: "select", label: "Select", visible: true, order: 0, locked: true, width: 48, minWidth: 48 },
  { id: "invoice", label: "Invoice #", visible: true, order: 1, required: true, width: 140, minWidth: 100 },
  { id: "customer", label: "Customer", visible: true, order: 2, width: 220, minWidth: 120 },
  { id: "actions", label: "Actions", visible: true, order: 3, locked: true, width: 230, minWidth: 220 },
];
const key = "tableConfig:global_invoices:org_a:user_b";
let config: ReturnType<typeof useTableColumnConfig>;

function Probe() {
  config = useTableColumnConfig("global_invoices:org_a:user_b", defaults);
  return <div>{config.columns.map((column) => `${column.id}:${column.width}:${column.visible}`).join("|")}</div>;
}

test("width preview stays local; committed width, visibility, and order survive remount; reset restores defaults", () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  const host = document.createElement("div");
  document.body.appendChild(host);
  let root: Root = createRoot(host);
  act(() => root.render(<Probe />));

  act(() => config.setColumnWidth("customer", 275, false));
  expect(config.columns.find((column) => column.id === "customer")?.width).toBe(275);
  expect(localStorage.getItem(key)).toBeNull();

  act(() => config.setColumnWidth("customer", 280));
  act(() => config.setColumnVisibility("customer", false));
  act(() => config.setColumnVisibility("invoice", false));
  act(() => config.moveColumn("customer", "up"));
  expect(config.columns.find((column) => column.id === "invoice")?.visible).toBe(true);
  expect(config.columns.map((column) => column.id)).toEqual(["select", "customer", "invoice", "actions"]);
  expect(JSON.parse(localStorage.getItem(key) || "[]").find((column: ColumnConfig) => column.id === "customer")?.width).toBe(280);

  act(() => root.unmount());
  root = createRoot(host);
  act(() => root.render(<Probe />));
  expect(config.columns.find((column) => column.id === "customer")).toMatchObject({ width: 280, visible: false });
  expect(config.columns.map((column) => column.id)).toEqual(["select", "customer", "invoice", "actions"]);

  act(() => config.reset());
  expect(config.columns.map((column) => [column.id, column.width, column.visible])).toEqual(
    defaults.map((column) => [column.id, column.width, column.visible]),
  );
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
});
