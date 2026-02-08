import React from 'react';
import { ProductHeader } from './ProductHeader';
import { OptionGroupsSidebar } from './OptionGroupsSidebar';
import { OptionEditor } from './OptionEditor';
import { PricingValidationPanel } from './PricingValidationPanel';
import { BasePricingEditor } from './BasePricingEditor';
import { PBV2EditorErrorBoundary } from './PBV2EditorErrorBoundary';
import type { EditorModel } from '@/lib/pbv2/pbv2ViewModel';
import type { Finding } from '@shared/pbv2/findings';

export interface PBV2ProductBuilderLayoutProps {
  // Editor model (derived from PBV2 tree)
  editorModel: EditorModel;
  treeJson: any; // Raw PBV2 tree for detailed editing
  
  // Selection state
  selectedGroupId: string | null;
  selectedOptionId: string | null;
  
  // Header props
  hasUnsavedChanges: boolean;
  canPublish: boolean;
  
  // Validation/preview
  findings: Finding[];
  pricingPreview: {
    addOnCents: number;
    breakdown: Array<{ label: string; cents: number }>;
  } | null;
  weightPreview: {
    totalOz: number;
    breakdown: Array<{ label: string; oz: number }>;
  } | null;
  
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
 * Presentational 3-column layout for PBV2 builder.
 * 
 * Responsive flex layout:
 * - Left sidebar (fixed 288px): Option groups
 * - Middle editor (flex grow): Selected group editor with min-w-0 for proper overflow
 * - Right panel (fixed 384px): Pricing validation
 * 
 * The middle column uses flex-1 min-w-0 to allow proper text truncation and flexing.
 */
export function PBV2ProductBuilderLayout({
  editorModel,
  treeJson,
  selectedGroupId,
  selectedOptionId,
  hasUnsavedChanges,
  canPublish,
  findings,
  pricingPreview,
  weightPreview,
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
    <div className="w-full">
      {/* Options Builder Card with fixed height */}
      <div className="bg-[#1e293b] border border-[#334155] rounded-lg overflow-hidden">
        {/* Card Header */}
        <div className="border-b border-[#334155] px-6 py-3.5">
          <h2 className="text-lg font-medium text-slate-200">Options Builder</h2>
        </div>

        {/* 3-column layout: fixed 800px height with independent scroll areas */}
        <div className="h-[800px] flex overflow-hidden bg-[#0a0e1a]">
          {/* Left Sidebar: Fixed width 288px (w-72), independent scroll */}
          <div className="w-72 shrink-0 border-r border-[#334155]">
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
      <div className="flex-1 min-w-0 overflow-y-auto bg-[#0a0e1a]">
        <div className="px-6 py-4">
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
          </div>
        </div>
      
          {/* Right Panel: Fixed width 384px (w-96), independent scroll */}
          <div className="w-96 shrink-0 border-l border-[#334155]">
            <PricingValidationPanel
              findings={findings}
              pricingPreview={pricingPreview}
              weightPreview={weightPreview}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
