import { buildSimpleXlsx } from '../lib/simpleXlsx';

describe('simple XLSX export', () => {
  test('generates an actual XLSX ZIP workbook, not a CSV payload', () => {
    const workbook = buildSimpleXlsx({
      sheetName: 'Accounts Receivable',
      title: 'Accounts Receivable',
      generatedAt: '2026-09-16T12:00:00.000Z',
      filterSummary: '{}',
      headers: ['Invoice', 'Balance'],
      rows: [['INV-101', 123.45]],
      totals: ['Totals', 123.45],
    });

    expect(workbook.subarray(0, 2).toString('utf8')).toBe('PK');
    expect(workbook.toString('utf8')).toContain('xl/workbook.xml');
    expect(workbook.toString('utf8')).toContain('xl/worksheets/sheet1.xml');
  });
});
