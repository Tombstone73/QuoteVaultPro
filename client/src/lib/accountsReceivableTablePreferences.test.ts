import {
  arReportDefaultColumns,
  getArReportPreferenceStorageKey,
  normalizeArReportColumns,
} from '@/lib/accountsReceivableTablePreferences';

describe('Accounts Receivable report table preferences', () => {
  test('preserves saved column order, visibility, and bounded widths', () => {
    const columns = normalizeArReportColumns([
      { id: 'balance', enabled: false, width: 9999 },
      { id: 'customer', enabled: true, width: 260 },
    ]);

    expect(columns.slice(0, 2).map((column) => column.id)).toEqual(['balance', 'customer']);
    expect(columns.find((column) => column.id === 'balance')).toMatchObject({ enabled: false, width: 240 });
    expect(columns.find((column) => column.id === 'customer')).toMatchObject({ enabled: true, width: 260 });
    expect(columns).toHaveLength(arReportDefaultColumns.length);
  });

  test('scopes persisted preferences by both user and organization', () => {
    expect(getArReportPreferenceStorageKey('user-a', 'org-a')).not.toBe(getArReportPreferenceStorageKey('user-b', 'org-a'));
    expect(getArReportPreferenceStorageKey('user-a', 'org-a')).not.toBe(getArReportPreferenceStorageKey('user-a', 'org-b'));
  });
});
