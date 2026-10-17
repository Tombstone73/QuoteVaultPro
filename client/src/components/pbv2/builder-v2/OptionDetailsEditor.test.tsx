import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { EditorOption } from '@/lib/pbv2/pbv2ViewModel';

jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isLoading: true, user: null }) }));
jest.mock('@/features/materials/CreateMaterialDialog', () => ({ CreateMaterialDialog: () => null }));
jest.mock('@/components/ui/button', () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
jest.mock('@/components/ui/input', () => ({ Input: (props: any) => <input {...props} /> }));
jest.mock('@/components/ui/textarea', () => ({ Textarea: (props: any) => <textarea {...props} /> }));
jest.mock('@/components/ui/label', () => ({ Label: ({ children, ...props }: any) => <label {...props}>{children}</label> }));
jest.mock('@/components/ui/switch', () => ({ Switch: () => null }));
jest.mock('@/components/ui/separator', () => ({ Separator: () => <hr /> }));
jest.mock('@/components/ui/select', () => ({ Select: ({ children }: any) => <div>{children}</div>, SelectContent: ({ children }: any) => <>{children}</>, SelectItem: ({ children }: any) => <div>{children}</div>, SelectTrigger: ({ children }: any) => <div>{children}</div>, SelectValue: () => null }));
jest.mock('@/components/ui/popover', () => ({ Popover: ({ children }: any) => <div>{children}</div>, PopoverContent: ({ children }: any) => <div>{children}</div>, PopoverTrigger: ({ children }: any) => <div>{children}</div> }));
jest.mock('@/components/ui/command', () => ({ Command: ({ children }: any) => <div>{children}</div>, CommandEmpty: ({ children }: any) => <div>{children}</div>, CommandInput: () => null, CommandItem: ({ children }: any) => <div>{children}</div>, CommandList: ({ children }: any) => <div>{children}</div>, CommandSeparator: () => <hr /> }));

import { OptionDetailsEditor } from './OptionDetailsEditor';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const option: EditorOption = {
  id: 'option', name: 'Option', description: '', type: 'dropdown', enabled: true,
  sortOrder: 0, isDefault: false, isRequired: false, selectionKey: 'option',
  hasPricing: false, hasProductionFlags: false, hasConditionals: false, hasWeight: false,
};

describe('OptionDetailsEditor pricing guidance', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  const variants: Array<[EditorOption['type'], string, boolean]> = [
    ['dropdown', 'select', true],
    ['radio', 'select', true],
    ['checkbox', 'boolean', false],
    ['numeric', 'number', false],
    ['text', 'text', false],
  ];
  test.each(variants)('%s displays the intended pricing guidance', (type, inputType, appliesToChoices) => {
    act(() => root.render(<OptionDetailsEditor
      option={{ ...option, type }}
      treeJson={{ nodes: { option: { id: 'option', label: 'Option', input: { type: inputType }, choices: [] } }, edges: [] }}
      onUpdateOption={jest.fn()} onAddChoice={jest.fn()} onUpdateChoice={jest.fn()}
      onDeleteChoice={jest.fn()} onReorderChoice={jest.fn()} onUpdateNodePricing={jest.fn()}
      onAddPricingRule={jest.fn()} onDeletePricingRule={jest.fn()}
      editingChoiceValue={null} setEditingChoiceValue={jest.fn()}
    />));
    const guidance = Array.from(container.querySelectorAll('p')).find(p => p.parentElement?.textContent?.includes('Pricing Impact'))?.textContent;
    expect(guidance).toBe(appliesToChoices
      ? 'Applies to every selected choice, including the default/NONE choice. Use the choice-level Pricing Impacts above for choice-specific charges.'
      : 'Add pricing rules that apply when this option is selected');
  });
});
