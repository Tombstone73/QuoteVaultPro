import { z } from "zod";
import type { AssistantOperatorObservation, AssistantOperatorTrustedContext } from "./operatorRuntime";

const MAX_INPUT_BYTES = 256_000;
const MAX_OUTPUT_BYTES = 64_000;
const MAX_ROWS = 1_000;
const safePathSchema = z.string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}(?:\.[A-Za-z][A-Za-z0-9_]{0,63}){0,3}$/)
  .refine((value) => !value.split(".").some((segment) => ["__proto__", "prototype", "constructor"].includes(segment)), "Unsafe path segment.");
const metricSchema = z.object({ as: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), op: z.enum(["count", "sum", "average", "min", "max"]), field: safePathSchema.optional() }).strict();
const scalarSchema = z.union([z.string().max(160), z.number().finite(), z.boolean()]);
const rangeSchema = z.object({
  label: z.string().trim().min(1).max(80),
  start: scalarSchema.optional(),
  endExclusive: scalarSchema.optional(),
}).strict().refine((range) => range.start !== undefined || range.endExclusive !== undefined, "A range needs a start or endExclusive value.");
const calculatedFieldSchema = z.object({
  as: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),
  calculation: z.enum(["add", "subtract", "multiply", "divide", "average", "percent_change"]),
  fields: z.array(safePathSchema).min(1).max(12),
}).strict().superRefine((value, ctx) => {
  if (["subtract", "multiply", "divide", "percent_change"].includes(value.calculation) && value.fields.length !== 2) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${value.calculation} requires exactly two fields.`, path: ["fields"] });
  }
});
const operationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("filter"), field: safePathSchema, comparison: z.enum(["equals", "not_equals", "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "in"]), value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number(), z.boolean()])).max(50)]) }).strict(),
  z.object({ op: z.literal("classify_range"), as: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), field: safePathSchema, ranges: z.array(rangeSchema).min(1).max(12), unmatched: z.string().trim().min(1).max(80).optional() }).strict(),
  z.object({ op: z.literal("project"), fields: z.array(z.object({ as: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), field: safePathSchema }).strict()).min(1).max(24) }).strict(),
  z.object({ op: z.literal("group"), by: z.array(safePathSchema).min(1).max(6), metrics: z.array(metricSchema).min(1).max(12) }).strict(),
  z.object({ op: z.literal("pivot"), by: z.array(safePathSchema).min(1).max(6), column: safePathSchema, values: z.array(z.object({ columnValue: scalarSchema, field: safePathSchema, as: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/) }).strict()).min(1).max(12), missingValue: z.number().finite().default(0) }).strict(),
  z.object({ op: z.literal("calculate"), fields: z.array(calculatedFieldSchema).min(1).max(12) }).strict(),
  z.object({ op: z.literal("sort"), field: safePathSchema, direction: z.enum(["ascending", "descending"]) }).strict(),
  z.object({ op: z.literal("limit"), count: z.number().int().min(1).max(100) }).strict(),
  z.object({ op: z.literal("summarize"), metrics: z.array(metricSchema).min(1).max(12) }).strict(),
]);
const inputSchema = z.object({
  purpose: z.string().trim().min(1).max(500),
  dataset: z.object({ source: z.enum(["current_turn", "trusted_task"]), toolName: z.string().trim().min(1).max(120), path: safePathSchema.optional() }).strict(),
  program: z.object({ operations: z.array(operationSchema).min(1).max(12) }).strict(),
}).strict();

type Row = Record<string, unknown>;

function atPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => current && typeof current === "object" && !Array.isArray(current) ? (current as Record<string, unknown>)[key] : undefined, value);
}
function asRows(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new Error("The selected dataset path is not a record list.");
  return value.filter((item): item is Row => Boolean(item && typeof item === "object" && !Array.isArray(item))).slice(0, MAX_ROWS);
}
function compare(left: unknown, comparison: z.infer<typeof operationSchema> & { op: "filter" }): boolean {
  const values = Array.isArray(comparison.value) ? comparison.value : [comparison.value];
  if (comparison.comparison === "in") return values.some((value) => value === left);
  if (comparison.comparison === "equals") return left === comparison.value;
  if (comparison.comparison === "not_equals") return left !== comparison.value;
  const right = comparison.value;
  const comparable = (typeof left === "number" && typeof right === "number") || (typeof left === "string" && typeof right === "string");
  if (!comparable) return false;
  if (comparison.comparison === "greater_than") return left > right;
  if (comparison.comparison === "greater_than_or_equal") return left >= right;
  if (comparison.comparison === "less_than") return left < right;
  return left <= right;
}
function inRange(value: unknown, range: z.infer<typeof rangeSchema>): boolean {
  if (range.start !== undefined && !((typeof value === "number" && typeof range.start === "number") || (typeof value === "string" && typeof range.start === "string"))) return false;
  if (range.endExclusive !== undefined && !((typeof value === "number" && typeof range.endExclusive === "number") || (typeof value === "string" && typeof range.endExclusive === "string"))) return false;
  return (range.start === undefined || value! >= range.start) && (range.endExclusive === undefined || value! < range.endExclusive);
}
function calculate(row: Row, definition: z.infer<typeof calculatedFieldSchema>): number | null {
  const values = definition.fields.map((field) => atPath(row, field));
  if (!values.every((value): value is number => typeof value === "number" && Number.isFinite(value))) return null;
  if (definition.calculation === "add") return values.reduce((total, value) => total + value, 0);
  if (definition.calculation === "average") return values.reduce((total, value) => total + value, 0) / values.length;
  const [left, right] = values as [number, number];
  if (definition.calculation === "subtract") return left - right;
  if (definition.calculation === "multiply") return left * right;
  if (definition.calculation === "divide") return right === 0 ? null : left / right;
  return right === 0 ? null : ((left - right) / right) * 100;
}
function metrics(rows: Row[], definitions: z.infer<typeof metricSchema>[]) {
  return Object.fromEntries(definitions.map((definition) => {
    const field = definition.field;
    const values = typeof field === "string" ? rows.map((row) => atPath(row, field)).filter((value): value is number => typeof value === "number" && Number.isFinite(value)) : [];
    const value = definition.op === "count" ? rows.length
      : definition.op === "sum" ? values.reduce((total, item) => total + item, 0)
        : definition.op === "average" ? (values.length ? values.reduce((total, item) => total + item, 0) / values.length : null)
          : definition.op === "min" ? (values.length ? Math.min(...values) : null)
            : values.length ? Math.max(...values) : null;
    return [definition.as, value];
  }));
}
function sourceObservations(context: AssistantOperatorTrustedContext, source: "current_turn" | "trusted_task") {
  return source === "current_turn" ? context.analysisObservations ?? [] : context.task?.trustedObservations ?? [];
}

/** A non-Turing-complete analysis workspace. The model supplies declarative
 * transformations; no model code is evaluated and it receives no ambient I/O. */
export function runOperatorAnalysis(rawInput: unknown, context: AssistantOperatorTrustedContext) {
  const input = inputSchema.parse(rawInput);
  const observations = sourceObservations(context, input.dataset.source);
  const observation = [...observations].reverse().find((item) => item.toolName === input.dataset.toolName);
  if (!observation) throw new Error("The requested authorized dataset is not available in this task.");
  const data = "data" in observation ? observation.data : observation.result?.data;
  if (JSON.stringify(data).length > MAX_INPUT_BYTES) throw new Error("The requested dataset is too large for the analysis workspace.");
  let rows = asRows(input.dataset.path ? atPath(data, input.dataset.path) : data);
  let summary: Record<string, unknown> | null = null;
  for (const operation of input.program.operations) {
    if (operation.op === "filter") rows = rows.filter((row) => compare(atPath(row, operation.field), operation as any));
    else if (operation.op === "classify_range") rows = rows.flatMap((row) => {
      const match = operation.ranges.find((range) => inRange(atPath(row, operation.field), range));
      return match ? [{ ...row, [operation.as]: match.label }] : operation.unmatched ? [{ ...row, [operation.as]: operation.unmatched }] : [];
    });
    else if (operation.op === "project") rows = rows.map((row) => Object.fromEntries(operation.fields.map((field) => [field.as, atPath(row, field.field)])));
    else if (operation.op === "group") {
      const groups = new Map<string, Row[]>();
      for (const row of rows) {
        const key = JSON.stringify(operation.by.map((field) => atPath(row, field)));
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }
      rows = Array.from(groups.values(), (group) => Object.assign(Object.fromEntries(operation.by.map((field) => [field.split(".").at(-1)!, atPath(group[0], field)])), metrics(group, operation.metrics)));
    } else if (operation.op === "pivot") {
      const groups = new Map<string, Row[]>();
      for (const row of rows) {
        const key = JSON.stringify(operation.by.map((field) => atPath(row, field)));
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }
      rows = Array.from(groups.values(), (group) => {
        const pivoted: Row = Object.fromEntries(operation.by.map((field) => [field.split(".").at(-1)!, atPath(group[0], field)]));
        for (const value of operation.values) {
          const matches = group.filter((row) => atPath(row, operation.column) === value.columnValue);
          if (matches.length > 1) throw new Error("Pivot requires one row per group and column value; group the data before pivoting.");
          pivoted[value.as] = matches.length ? atPath(matches[0], value.field) : operation.missingValue;
        }
        return pivoted;
      });
    } else if (operation.op === "calculate") {
      rows = rows.map((row) => ({ ...row, ...Object.fromEntries(operation.fields.map((field) => [field.as, calculate(row, field)])) }));
    } else if (operation.op === "sort") {
      rows = [...rows].sort((a, b) => {
        const left = atPath(a, operation.field); const right = atPath(b, operation.field);
        const order = typeof left === "number" && typeof right === "number" ? left - right : String(left ?? "").localeCompare(String(right ?? ""));
        return operation.direction === "ascending" ? order : -order;
      });
    } else if (operation.op === "limit") rows = rows.slice(0, operation.count);
    else summary = metrics(rows, operation.metrics);
  }
  const result = { purpose: input.purpose, rows, summary, inputRowCount: asRows(input.dataset.path ? atPath(data, input.dataset.path) : data).length, outputRowCount: rows.length, dataset: { toolName: observation.toolName, source: input.dataset.source, path: input.dataset.path ?? null } };
  if (JSON.stringify(result).length > MAX_OUTPUT_BYTES) throw new Error("The analysis result exceeded the safe output limit.");
  return result;
}
