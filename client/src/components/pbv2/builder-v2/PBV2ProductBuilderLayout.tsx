import React from 'react';
import { Settings } from 'lucide-react';
import { ProductHeader } from './ProductHeader';
import { OptionGroupsSidebar } from './OptionGroupsSidebar';
import { OptionEditor } from './OptionEditor';
import { BasePricingEditor } from './BasePricingEditor';
import { OptionRulesPricingMatrixEditor } from './OptionRulesPricingMatrixEditor';
import { PBV2EditorErrorBoundary } from './PBV2EditorErrorBoundary';
import type { EditorModel } from '@/lib/pbv2/pbv2ViewModel';
import type { ProductOptionRule } from '@shared/productOptionRules';
import type { ProductOptionPricingMatrix } from '@shared/productOptionPricingMatrix';

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
  onImportTemplate: () => void;
  onSaveGroupAsTemplate: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onReorderGroup: (fromIndex: number, toIndex: number) => void;
  onAddOption: (groupId: string) => void;
  onDeleteOption: (groupId: string, optionId: string) => void;
  onUpdateGroup: (groupId: string, updates: any) => void;
  onUpdateProduct: (updates: any) => void;
  onUpdateOption: (optionId: string, updates: any) => void;
  onAddChoice: (optionId: string) => void;
  onUpdateChoice: (optionId: string, choiceValue: string, updates: any) => void;
  onDeleteChoice: (optionId: string, choiceValue: string) => void;
  onReorderChoice: (optionId: string, fromIndex: number, toIndex: number) => void;
  onUpdateNodePricing: (optionId: string, pricingImpact: any[]) => void;
  onAddPricingRule: (optionId: string, rule: { mode: string; cents?: number; amountCents?: number; label?: string }) => void;
  onDeletePricingRule: (optionId: string, ruleIndex: number) => void;
  onUpdatePricingV2Base: (base: { perSqftCents?: number; perPieceCents?: number; minimumChargeCents?: number }) => void;
  onUpdatePricingV2UnitSystem: (unitSystem: 'imperial' | 'metric') => void;
  onAddPricingV2Tier: (kind: 'qty' | 'sqft') => void;
  onUpdatePricingV2Tier: (kind: 'qty' | 'sqft', index: number, tier: any) => void;
  onDeletePricingV2Tier: (kind: 'qty' | 'sqft', index: number) => void;
  onUpdateOptionRules: (rules: ProductOptionRule[]) => void;
  onUpdatePricingMatrix: (pricingMatrix: ProductOptionPricingMatrix) => void;
  onRepairPricingMatrix: () => void;
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
  onImportTemplate,
  onSaveGroupAsTemplate,
  onDeleteGroup,
  onReorderGroup,
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
  onUpdateOptionRules,
  onUpdatePricingMatrix,
  onRepairPricingMatrix,
  onUpdateProduct,
  onSave,
  onPublish,
  onExportJson,
  onImportJson,
}: PBV2ProductBuilderLayoutProps) {
  const selectedGroup = editorModel.groups.find(g => g.id === selectedGroupId);

  return (
    <div className="flex min-w-0 flex-col bg-[#1e293b] lg:min-h-[600px] lg:flex-row">
      {/* Option groups remain in normal page flow so long editor content has one scroll owner. */}
      <div className="w-full border-b border-slate-700 bg-[#1e293b] lg:w-72 lg:shrink-0 lg:border-b-0 lg:border-r">
        <OptionGroupsSidebar
          optionGroups={editorModel.groups}
          options={editorModel.options}
          selectedGroupId={selectedGroupId}
          onSelectGroup={onSelectGroup}
          onAddGroup={onAddGroup}
          onImportTemplate={onImportTemplate}
          onSaveGroupAsTemplate={onSaveGroupAsTemplate}
          onDeleteGroup={onDeleteGroup}
          onReorderGroup={onReorderGroup}
        />
      </div>

      <div className="min-w-0 flex-1 bg-[#1e293b]">
        <div className="p-4 space-y-4">
          {/* Selected group editor */}
          {selectedGroup ? (
            <PBV2EditorErrorBoundary
              // The option editor owns its expanded-option state. Keying this
              // boundary by the selected option remounted it as soon as an
              // option was opened, immediately collapsing its choice list.
              key={selectedGroupId ?? ''}
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
          ) : (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <div className="text-center">
                <Settings className="h-12 w-12 mx-auto mb-3 text-slate-600" />
                <p className="text-sm">Select an option group to edit choices, or manage option rules below.</p>
              </div>
            </div>
          )}

          {/* Option Rules and Pricing Matrix — product-level, always visible */}
          <PBV2EditorErrorBoundary>
            <OptionRulesPricingMatrixEditor
              treeJson={treeJson}
              onUpdateRules={onUpdateOptionRules}
              onUpdatePricingMatrix={onUpdatePricingMatrix}
              onRepairPricingMatrix={onRepairPricingMatrix}
            />
          </PBV2EditorErrorBoundary>
        </div>
      </div>
    </div>
  );
}
