import * as React from "react";
import { Button } from "@/components/ui/button";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const cents = (value: unknown): number | null => typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
const list = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter((item): item is string => Boolean(item)) : [];

export type ConfigurableProductConfirmationCard = {
  proposalId: string; fingerprint: string; name: string; category: string; sheetWidthIn: number; sheetHeightIn: number;
  allowRotation: boolean; route: string; minimumChargeCents: number; optionGroups: Array<{ key: string; name: string; values: Array<{ value: string; label: string }> }>;
  rows: string[]; columns: string[]; cells: Record<string, number>; warnings: string[]; blockers: string[]; ready: boolean;
};
export type ConfigurableProductResultCard = { proposalId: string; productId: string; treeId: string; optionGroupCount: number; optionValueCount: number; matrixRowCount: number; matrixColumnCount: number; matrixCellCount: number; warnings: string[]; blockers: string[]; reused: boolean; };
export type ConfigurableProductProposalCard = { turnId: string; title: string; confirmation: ConfigurableProductConfirmationCard };

/** Strictly validates every display-critical field. Unsupported/incomplete payloads render nothing. */
export function toConfigurableProductConfirmation(value: unknown): ConfigurableProductConfirmationCard | null {
  const dto = record(value); const product = record(dto?.product); const matrix = record(dto?.matrix); const readiness = record(dto?.readiness);
  if (!dto || dto.kind !== "configurable_product_confirmation" || dto.version !== "v1" || !product || !matrix || !readiness) return null;
  const proposalId = text(dto.proposalId); const fingerprint = text(dto.fingerprint); const name = text(product.name); const category = text(product.category); const route = text(product.route);
  const sheetWidthIn = typeof product.sheetWidthIn === "number" && product.sheetWidthIn > 0 ? product.sheetWidthIn : null;
  const sheetHeightIn = typeof product.sheetHeightIn === "number" && product.sheetHeightIn > 0 ? product.sheetHeightIn : null;
  const minimumChargeCents = cents(product.minimumChargeCents); const rows = Array.isArray(matrix.rowValues) ? matrix.rowValues.map(text).filter((item): item is string => Boolean(item)) : [];
  const columns = Array.isArray(matrix.columnValues) ? matrix.columnValues.map(text).filter((item): item is string => Boolean(item)) : [];
  const rawCells = record(matrix.cells); const rawGroups = Array.isArray(dto.optionGroups) ? dto.optionGroups : [];
  const optionGroups = rawGroups.flatMap((group) => { const item = record(group); const key = text(item?.key); const groupName = text(item?.name); const values = Array.isArray(item?.values) ? item!.values.flatMap((value) => { const choice = record(value); const choiceValue = text(choice?.value); const label = text(choice?.label); return choiceValue && label ? [{ value: choiceValue, label }] : []; }) : []; return key && groupName && item?.required === true && item?.selectionMode === "single" && values.length ? [{ key, name: groupName, values }] : []; });
  if (!proposalId || !/^[a-f0-9-]{16,}$/i.test(proposalId) || !fingerprint || !/^[a-f0-9]{64}$/i.test(fingerprint) || !name || !category || !route || sheetWidthIn === null || sheetHeightIn === null || minimumChargeCents === null || typeof product.allowRotation !== "boolean" || optionGroups.length !== 2 || rows.length === 0 || columns.length === 0 || !rawCells) return null;
  const cells: Record<string, number> = {};
  for (const row of rows) for (const column of columns) { const key = `${row}\u0000${column}`; const value = cents(rawCells[key]); if (value === null) return null; cells[key] = value; }
  const blockers = list(dto.blockers); const ready = readiness.ready === true && blockers.length === 0 && dto.goEligible === true;
  return { proposalId, fingerprint, name, category, sheetWidthIn, sheetHeightIn, allowRotation: product.allowRotation, route, minimumChargeCents, optionGroups, rows, columns, cells, warnings: list(dto.warnings), blockers, ready };
}

export function toConfigurableProductResult(value: unknown): ConfigurableProductResultCard | null {
  const dto = record(value);
  if (!dto || dto.kind !== "configurable_product_result" || dto.version !== "v1" || dto.inactive !== true || dto.pbv2Status !== "DRAFT" || dto.unpublished !== true) return null;
  const proposalId = text(dto.proposalId); const productId = text(dto.productId); const treeId = text(dto.pbv2TreeVersionId);
  const counts = [dto.optionGroupCount, dto.optionValueCount, dto.matrixRowCount, dto.matrixColumnCount, dto.matrixCellCount];
  if (!proposalId || !productId || !treeId || !counts.every((value) => typeof value === "number" && Number.isInteger(value) && value >= 0) || typeof dto.reused !== "boolean") return null;
  return { proposalId, productId, treeId, optionGroupCount: dto.optionGroupCount as number, optionValueCount: dto.optionValueCount as number, matrixRowCount: dto.matrixRowCount as number, matrixColumnCount: dto.matrixColumnCount as number, matrixCellCount: dto.matrixCellCount as number, warnings: list(dto.warnings), blockers: list(dto.blockers), reused: dto.reused };
}

export function toConfigurableProductProposal(value: unknown): ConfigurableProductProposalCard | null {
  const card = record(value); const plan = record(card?.plan) ?? record(card?.proposal);
  if (!card || card.kind !== "action_proposal" || !plan || plan.action !== "products.create_configurable_draft") return null;
  const turnId = text(plan.turnId) ?? text(card.turnId); const confirmation = toConfigurableProductConfirmation(plan.configurableProduct);
  return turnId && confirmation ? { turnId, title: text(card.title) ?? "Create configurable inactive product draft", confirmation } : null;
}

const money = (value: number) => `$${(value / 100).toFixed(2)}`;
function Messages({ title, values, tone }: { title: string; values: string[]; tone: "warning" | "blocker" }) { return values.length ? <div className={`mt-2 rounded border p-2 ${tone === "blocker" ? "border-destructive/30 bg-destructive/5" : "border-amber-500/30 bg-amber-500/10"}`}><p className="font-medium">{title}</p><ul className="mt-1 list-disc pl-4">{values.map((value) => <li key={value}>{value}</li>)}</ul></div> : null; }

export function ConfigurableProductConfirmationCardView({ confirmation, onCreatePlan, creating }: { confirmation: ConfigurableProductConfirmationCard; onCreatePlan?: () => void; creating?: boolean }) {
  return <section className="mt-2 rounded-md border border-primary/25 bg-background/80 p-3 text-xs" aria-label={`Configurable product confirmation: ${confirmation.name}`}>
    <p className="font-semibold">Configurable inactive product draft</p><p className="mt-1 text-muted-foreground">{confirmation.name} · {confirmation.category}</p>
    <dl className="mt-2 grid gap-1 sm:grid-cols-2"><div><dt className="inline font-medium">Lifecycle: </dt><dd className="inline">Inactive · PBV2 DRAFT · Unpublished</dd></div><div><dt className="inline font-medium">Sheet: </dt><dd className="inline">{confirmation.sheetWidthIn} × {confirmation.sheetHeightIn} in</dd></div><div><dt className="inline font-medium">Rotation: </dt><dd className="inline">{confirmation.allowRotation ? "Allowed" : "Not allowed"}</dd></div><div><dt className="inline font-medium">Route: </dt><dd className="inline">{confirmation.route}</dd></div><div><dt className="inline font-medium">Minimum charge: </dt><dd className="inline">{money(confirmation.minimumChargeCents)}</dd></div></dl>
    <div className="mt-3"><p className="font-medium">Required single-select options</p>{confirmation.optionGroups.map((group) => <div key={group.key} className="mt-1"><span className="font-medium">{group.name}: </span>{group.values.map((value) => value.label).join(", ")}</div>)}</div>
    <div className="mt-3 overflow-x-auto"><p className="font-medium">Per-square-foot pricing matrix</p><table className="mt-1 w-full min-w-[28rem] border-collapse text-left"><thead><tr><th className="border-b p-1">{confirmation.optionGroups[0].name}</th>{confirmation.columns.map((column) => <th key={column} className="border-b p-1">{column}</th>)}</tr></thead><tbody>{confirmation.rows.map((row) => <tr key={row}><th className="border-b p-1">{row}</th>{confirmation.columns.map((column) => <td key={column} className="border-b p-1">{money(confirmation.cells[`${row}\u0000${column}`])}</td>)}</tr>)}</tbody></table></div>
    <Messages title="Blockers" values={confirmation.blockers} tone="blocker" /><Messages title="Warnings" values={confirmation.warnings} tone="warning" />
    <p className="mt-2 font-medium">Readiness: {confirmation.ready ? "Ready for dedicated GO confirmation" : "Not ready — no executable action is available"}</p>
    {confirmation.ready && onCreatePlan ? <div className="mt-2"><Button type="button" size="sm" disabled={creating} onClick={onCreatePlan}>{creating ? "Preparing plan…" : "Review configurable-product plan"}</Button></div> : null}
  </section>;
}

export function ConfigurableProductResultCardView({ result }: { result: ConfigurableProductResultCard }) { return <section className="mt-3 rounded border border-primary/25 bg-primary/5 p-3 text-xs" aria-label="Configurable product execution result"><p className="font-semibold">Configurable product draft created</p><p className="mt-1">Product ID: <span className="font-mono">{result.productId}</span></p><p>PBV2 tree/version ID: <span className="font-mono">{result.treeId}</span></p><p className="mt-1">Inactive · PBV2 DRAFT · Unpublished · Not live-quotable</p><p className="mt-1">{result.optionGroupCount} option groups, {result.optionValueCount} option values; {result.matrixRowCount} × {result.matrixColumnCount} pricing matrix ({result.matrixCellCount} cells).</p><p className="mt-1">{result.reused ? "Replay returned the original product and tree IDs; no duplicate product was created." : "Created once from the confirmed persisted proposal."}</p><Messages title="Warnings" values={result.warnings} tone="warning" /><Messages title="Blockers" values={result.blockers} tone="blocker" /></section>; }
