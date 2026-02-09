import React from 'react';
import { Settings } from 'lucide-react';
import { ProductHeader } from './ProductHeader';
import { OptionGroupsSidebar } from './OptionGroupsSidebar';
import { OptionEditor } from './OptionEditor';
import { BasePricingEditor } from './BasePricingEditor';
import { PBV2EditorErrorBoundary } from './PBV2EditorErrorBoundary';
import type { EditorModel } from '@/lib/pbv2/pbv2ViewModel';

export interface PBV2ProductBuilderLayoutProps {
  // Editor model (derived from PBV2 tree)
  editorModel: EditorModel;
  treeJson: any; // Raw PBV2 tree for detailed editing

  // Selection state
  selectedGroupId: string | null;
  selectedOptionId: string | null;

  // Handlers
  onSelectGroup: (groupId: string) => void;
  onSelectOption: (optionId: string | null) => void;
  onAddGroup: () => void;
  onDeleteGroup: (groupId: string) => void;
  onAddOption: (groupId: string) => void;
  onDeleteOption: (groupId: string, optionId: string) => void;
  onUpdateGroup: (groupId: string, updates: any) => void;
  onUpdateProduct: (updates: any) => void;
  onUpdateOption: (optionId: string, updates: any) => void;
  onAddChoice: (optionId: string) => void;
  onUpdateChoice: (optionId: string, choiceValue: string, updates: any) => void;
  onDeleteChoice: (optionId: string, choiceValue: string) => void;
  onReorderChoice: (optionId: string, fromIndex: number, toIndex: number) => void;
  onUpdateNodePricing: (optionId: string, pricingImpact: Array<{ mode: 'addFlatCents' | 'addPerQtyCents' | 'addPerSqftCents'; cents: number; label?: string }>) => void;
  onAddPricingRule: (optionId: string, rule: { mode: 'addFlatCents' | 'addPerQtyCents' | 'addPerSqftCents'; cents: number; label?: string }) => void;
  onDeletePricingRule: (optionId: string, ruleIndex: number) => void;
  onUpdatePricingV2Base: (base: { perSqftCents?: number; perPieceCents?: number; minimumChargeCents?: number }) => void;
  onUpdatePricingV2UnitSystem: (unitSystem: 'imperial' | 'metric') => void;
  onAddPricingV2Tier: (kind: 'qty' | 'sqft') => void;
  onUpdatePricingV2Tier: (kind: 'qty' | 'sqft', index: number, tier: any) => void;
  onDeletePricingV2Tier: (kind: 'qty' | 'sqft', index: number) => void;
  onSave: () => void;
  onPublish: () => void;
  onExportJson: () => void;
  onImportJson: () => void;
}

/**
 * Presentational 2-column layout for PBV2 builder.
 *
 * Responsive flex layout:
 * - Left sidebar (fixed 288px): Option groups
 * - Middle editor (flex grow): Selected group editor with min-w-0 for proper overflow
 *
 * The middle column uses flex-1 min-w-0 to allow proper text truncation and flexing.
 *
 * NOTE: Pricing validation panel has been moved to page level (ProductEditorPage)
 */
export function PBV2ProductBuilderLayout({
  editorModel,
  treeJson,
  selectedGroupId,
  selectedOptionId,
  onSelectGroup,
  onSelectOption,
  onAddGroup,
  onDeleteGroup,
  onAddOption,
  onDeleteOption,
  onUpdateGroup,
  onUpdateOption,
  onAddChoice,
  onUpdateChoice,
  onDeleteChoice,
  onReorderChoice,
  onUpdateNodePricing,
  onAddPricingRule,
  onDeletePricingRule,
  onUpdatePricingV2Base,
  onUpdatePricingV2UnitSystem,
  onAddPricingV2Tier,
  onUpdatePricingV2Tier,
  onDeletePricingV2Tier,
  onUpdateProduct,
  onSave,
  onPublish,
  onExportJson,
  onImportJson,
}: PBV2ProductBuilderLayoutProps) {
  const selectedGroup = editorModel.groups.find(g => g.id === selectedGroupId);

  return (
    <div className="min-h-[600px] flex overflow-hidden bg-[#1e293b]">
      {/* Left Sidebar: Fixed width 288px (w-72), independent scroll */}
      <div className="w-72 shrink-0 border-r border-slate-700 bg-[#1e293b]">
        <OptionGroupsSidebar
          optionGroups={editorModel.groups}
          options={editorModel.options}
          selectedGroupId={selectedGroupId}
          onSelectGroup={onSelectGroup}
          onAddGroup={onAddGroup}
          onDeleteGroup={onDeleteGroup}
        />
      </div>

      {/* Middle Editor: Flex grow with min-w-0 for proper overflow, single unified scroll */}
      <div className="flex-1 min-w-0 overflow-y-auto bg-[#1e293b]">
        <div className="p-4">
            {/* Selected group editor */}
            {selectedGroup && (
              <PBV2EditorErrorBoundary
                key={`${selectedGroupId ?? ''}_${selectedOptionId ?? ''}`}
                onReset={() => { onSelectGroup(editorModel.groups[0]?.id ?? ''); onSelectOption(null); }}
              >
                <OptionEditor
                  selectedGroup={selectedGroup}
                  options={editorModel.options}
                  selectedOptionId={selectedOptionId}
                  onSelectOption={onSelectOption}
                  onAddOption={onAddOption}
                  onDeleteOption={onDeleteOption}
                  onUpdateGroup={onUpdateGroup}
                  treeJson={treeJson}
                  onUpdateOption={onUpdateOption}
                  onAddChoice={onAddChoice}
                  onUpdateChoice={onUpdateChoice}
                  onDeleteChoice={onDeleteChoice}
                  onReorderChoice={onReorderChoice}
                  onUpdateNodePricing={onUpdateNodePricing}
                  onAddPricingRule={onAddPricingRule}
                  onDeletePricingRule={onDeletePricingRule}
                />
              </PBV2EditorErrorBoundary>
            )}
            {!selectedGroup && (
              <div className="flex items-center justify-center h-full text-slate-400">
                <div className="text-center">
                  <Settings className="h-12 w-12 mx-auto mb-3 text-slate-600" />
                  <p className="text-sm">Select an option group to begin editing</p>
                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
