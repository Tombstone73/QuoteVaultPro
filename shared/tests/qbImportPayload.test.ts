import { describe, expect, test } from '@jest/globals';
import {
  buildQBImportPayload,
  computeQBImportSummary,
  resolveRowClassification,
  QBImportPreviewRow,
  QBImportOverrideMap,
} from '../qbImportPayload';

function makeRow(id: string, cls: 'open_ar' | 'historical', canImport = true): QBImportPreviewRow {
  return { qbInvoiceId: id, classification: cls, canImport };
}

// ==================== resolveRowClassification ====================

describe('resolveRowClassification', () => {
  test('returns suggested classification when no override', () => {
    expect(resolveRowClassification(makeRow('1', 'open_ar'), {})).toBe('open_ar');
    expect(resolveRowClassification(makeRow('2', 'historical'), {})).toBe('historical');
  });

  test('returns row override when set to open_ar', () => {
    expect(resolveRowClassification(makeRow('1', 'historical'), { '1': 'open_ar' })).toBe('open_ar');
  });

  test('returns row override when set to historical', () => {
    expect(resolveRowClassification(makeRow('1', 'open_ar'), { '1': 'historical' })).toBe('historical');
  });

  test('returns skip when override is skip', () => {
    expect(resolveRowClassification(makeRow('1', 'open_ar'), { '1': 'skip' })).toBe('skip');
  });

  test('suggested override is treated as no override (falls through to classification)', () => {
    expect(resolveRowClassification(makeRow('1', 'historical'), { '1': 'suggested' })).toBe('historical');
  });

  test('bulkOverride wins over row override', () => {
    expect(resolveRowClassification(makeRow('1', 'historical'), { '1': 'open_ar' }, 'historical')).toBe('historical');
    expect(resolveRowClassification(makeRow('1', 'open_ar'), { '1': 'skip' }, 'open_ar')).toBe('open_ar');
  });
});

// ==================== buildQBImportPayload ====================

describe('buildQBImportPayload', () => {
  const rows = [
    makeRow('ar1', 'open_ar'),
    makeRow('hist1', 'historical'),
    makeRow('excluded1', 'open_ar', false),
    makeRow('ar2', 'open_ar'),
  ];

  test('includes only selected AND canImport rows', () => {
    const selected = new Set(['ar1', 'hist1', 'excluded1']);
    const payload = buildQBImportPayload(selected, rows, {});
    const ids = payload.map(p => p.qbId);
    expect(ids).toContain('ar1');
    expect(ids).toContain('hist1');
    expect(ids).not.toContain('excluded1');
    expect(ids).not.toContain('ar2');
  });

  test('uses suggested classification for rows without override', () => {
    const selected = new Set(['ar1', 'hist1']);
    const payload = buildQBImportPayload(selected, rows, {});
    expect(payload.find(p => p.qbId === 'ar1')?.classification).toBe('open_ar');
    expect(payload.find(p => p.qbId === 'hist1')?.classification).toBe('historical');
  });

  test('uses row override when present', () => {
    const selected = new Set(['ar1', 'hist1']);
    const overrides: QBImportOverrideMap = { ar1: 'historical', hist1: 'skip' };
    const payload = buildQBImportPayload(selected, rows, overrides);
    expect(payload.find(p => p.qbId === 'ar1')?.classification).toBe('historical');
    expect(payload.find(p => p.qbId === 'hist1')?.classification).toBe('skip');
  });

  test('bulkOverride forces all eligible rows to that classification', () => {
    const selected = new Set(['ar1', 'hist1', 'ar2']);
    const overrides: QBImportOverrideMap = { ar1: 'skip', hist1: 'open_ar' };
    const payload = buildQBImportPayload(selected, rows, overrides, 'historical');
    for (const item of payload) {
      expect(item.classification).toBe('historical');
    }
  });

  test('skipped rows are included in payload (caller may filter)', () => {
    const selected = new Set(['ar1', 'hist1']);
    const overrides: QBImportOverrideMap = { ar1: 'skip' };
    const payload = buildQBImportPayload(selected, rows, overrides);
    const skipItem = payload.find(p => p.qbId === 'ar1');
    expect(skipItem?.classification).toBe('skip');
  });

  test('empty selection returns empty payload', () => {
    expect(buildQBImportPayload(new Set(), rows, {})).toHaveLength(0);
  });
});

// ==================== computeQBImportSummary ====================

describe('computeQBImportSummary', () => {
  const rows = [
    makeRow('ar1', 'open_ar'),
    makeRow('ar2', 'open_ar'),
    makeRow('hist1', 'historical'),
    makeRow('excl1', 'open_ar', false),
  ];

  test('counts open_ar and historical correctly', () => {
    const selected = new Set(['ar1', 'ar2', 'hist1']);
    const summary = computeQBImportSummary(selected, rows, {});
    expect(summary.openAr).toBe(2);
    expect(summary.historical).toBe(1);
    expect(summary.importable).toBe(3);
    expect(summary.skipped).toBe(0);
    expect(summary.excluded).toBe(0);
  });

  test('counts excluded rows separately', () => {
    const selected = new Set(['ar1', 'excl1']);
    const summary = computeQBImportSummary(selected, rows, {});
    expect(summary.openAr).toBe(1);
    expect(summary.excluded).toBe(1);
  });

  test('counts skip overrides as skipped', () => {
    const selected = new Set(['ar1', 'ar2', 'hist1']);
    const overrides: QBImportOverrideMap = { ar1: 'skip' };
    const summary = computeQBImportSummary(selected, rows, overrides);
    expect(summary.skipped).toBe(1);
    expect(summary.openAr).toBe(1);
    expect(summary.historical).toBe(1);
    expect(summary.importable).toBe(2);
  });

  test('unselected rows are not counted', () => {
    const selected = new Set(['ar1']);
    const summary = computeQBImportSummary(selected, rows, {});
    expect(summary.openAr).toBe(1);
    expect(summary.historical).toBe(0);
  });

  test('empty selection gives all zeros', () => {
    const summary = computeQBImportSummary(new Set(), rows, {});
    expect(summary).toEqual({ openAr: 0, historical: 0, skipped: 0, excluded: 0, importable: 0 });
  });
});

// ==================== Safety contracts ====================

describe('QB import safety contracts', () => {
  test('excluded rows are never in the import payload regardless of selection', () => {
    const excluded = makeRow('x', 'open_ar', false);
    const selected = new Set(['x']);
    const payload = buildQBImportPayload(selected, [excluded], {});
    expect(payload).toHaveLength(0);
  });

  test('skip rows are never importable (classification stays skip)', () => {
    const row = makeRow('s', 'open_ar');
    const payload = buildQBImportPayload(new Set(['s']), [row], { s: 'skip' });
    const toImport = payload.filter(p => p.classification !== 'skip');
    expect(toImport).toHaveLength(0);
  });

  test('bulk override does not lift excluded rows into the payload', () => {
    const excluded = makeRow('e', 'open_ar', false);
    const payload = buildQBImportPayload(new Set(['e']), [excluded], {}, 'open_ar');
    expect(payload).toHaveLength(0);
  });
});
