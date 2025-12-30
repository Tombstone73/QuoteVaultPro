export type CsvValue = string | number | boolean | null | undefined;

export function escapeCsvValue(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  const needsQuotes = /[",\r\n]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

export function buildCsv(rows: CsvValue[][], opts?: { includeHeaders?: boolean }): string {
  const includeHeaders = opts?.includeHeaders !== false;
  const normalizedRows = includeHeaders ? rows : rows.slice(1);
  return normalizedRows.map((row) => row.map(escapeCsvValue).join(",")).join("\r\n") + "\r\n";
}
