import React from 'react';
import { ProductHeader } from './ProductHeader';
import { OptionGroupsSidebar } from './OptionGroupsSidebar';
import { OptionEditor } from './OptionEditor';
import { PricingValidationPanel } from './PricingValidationPanel';
import { BasePricingEditor } from './BasePricingEditor';
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
    <div className="w-full h-full flex flex-col bg-[#0a0e1a]">
      {/* Fixed header */}
      <ProductHeader
        productName={editorModel.productMeta.name}
        productStatus={editorModel.productMeta.status}
        hasUnsavedChanges={hasUnsavedChanges}
        canPublish={canPublish}
        onSave={onSave}
        onPublish={onPublish}
        onExportJson={onExportJson}
        onImportJson={onImportJson}
        onUpdateProductName={(name) => onUpdateProduct({ name })}
      />
      
      {/* Base Pricing Model section */}
      <div className="px-4 py-3 border-b border-slate-700">
        <BasePricingEditor
          pricingV2={(treeJson as any)?.meta?.pricingV2 || null}
          onUpdateBase={onUpdatePricingV2Base}
          onUpdateUnitSystem={onUpdatePricingV2UnitSystem}
          onAddTier={onAddPricingV2Tier}
          onUpdateTier={onUpdatePricingV2Tier}
          onDeleteTier={onDeletePricingV2Tier}
        />
      </div>
      
      {/* 3-column layout: flex-1 fills remaining space, overflow-hidden prevents scroll leaks */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar: Fixed width (288px), shrink-0 prevents it from shrinking */}
        <div className="w-72 shrink-0 overflow-hidden">
          <OptionGroupsSidebar
            optionGroups={editorModel.groups}
            options={editorModel.options}
            selectedGroupId={selectedGroupId}
            onSelectGroup={onSelectGroup}
            onAddGroup={onAddGroup}
            onDeleteGroup={onDeleteGroup}
          />
        </div>
        
        {/* Middle Editor: Flex grow with min-w-0 for proper content overflow handling */}
        <div className="flex-1 min-w-0 overflow-hidden">
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
        </div>
        
        {/* Right Panel: Fixed width (384px), shrink-0 prevents it from shrinking */}
        <div className="w-96 shrink-0 overflow-hidden">
          <PricingValidationPanel
            findings={findings}
            pricingPreview={pricingPreview}
            weightPreview={weightPreview}
          />
        </div>
      </div>
    </div>
  );
}
