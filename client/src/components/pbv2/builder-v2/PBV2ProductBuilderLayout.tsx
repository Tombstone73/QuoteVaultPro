import React from 'react';
import { ProductHeader } from './ProductHeader';
import { OptionGroupsSidebar } from './OptionGroupsSidebar';
import { OptionEditor } from './OptionEditor';
import { PricingValidationPanel } from './PricingValidationPanel';
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
  publishAttempted: boolean; // Part D: Track if user attempted publish
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
  onDuplicateOption: (groupId: string, optionId: string) => void;
  onDeleteOption: (groupId: string, optionId: string) => void;
  onReorderOption: (groupId: string, fromIndex: number, toIndex: number) => void;
  onMoveOption: (fromGroupId: string, toGroupId: string, optionId: string) => void;
  onUpdateGroup: (groupId: string, updates: any) => void;
  onUpdateProduct: (updates: any) => void;
  onUpdateOption: (optionId: string, updates: any) => void;
  onAddChoice: (optionId: string) => void;
  onUpdateChoice: (optionId: string, choiceValue: string, updates: any) => void;
  onDeleteChoice: (optionId: string, choiceValue: string) => void;
  onReorderChoice: (optionId: string, fromIndex: number, toIndex: number) => void;
  onUpdateBaseWeight: (weightOz?: number) => void;
  onAddWeightImpact: (nodeId: string) => void;
  onUpdateWeightImpact: (nodeId: string, index: number, updates: any) => void;
  onDeleteWeightImpact: (nodeId: string, index: number) => void;
  onUpdateBasePrice: (priceCents?: number) => void;
  onAddPricingImpact: (nodeId: string) => void;
  onUpdatePricingImpact: (nodeId: string, index: number, updates: any) => void;
  onDeletePricingImpact: (nodeId: string, index: number) => void;
  onUpdateChoicePriceDelta: (nodeId: string, choiceValue: string, priceDeltaCents?: number) => void;
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
  publishAttempted,
  pricingPreview,
  weightPreview,
  onSelectGroup,
  onSelectOption,
  onAddGroup,
  onDeleteGroup,
  onAddOption,
  onDuplicateOption,
  onDeleteOption,
  onReorderOption,
  onMoveOption,
  onUpdateGroup,
  onUpdateOption,
  onAddChoice,
  onUpdateChoice,
  onDeleteChoice,
  onReorderChoice,
  onUpdateProduct,
  onUpdateBaseWeight,
  onAddWeightImpact,
  onUpdateWeightImpact,
  onDeleteWeightImpact,
  onUpdateBasePrice,
  onAddPricingImpact,
  onUpdatePricingImpact,
  onDeletePricingImpact,
  onUpdateChoicePriceDelta,
  onSave,
  onPublish,
  onExportJson,
  onImportJson,
}: PBV2ProductBuilderLayoutProps) {
  const selectedGroup = editorModel.groups.find(g => g.id === selectedGroupId);

  // Extract base weight and base price from tree
  const baseWeightOz = (treeJson?.meta?.baseWeightOz !== undefined) ? Number(treeJson.meta.baseWeightOz) : undefined;
  const basePriceCents = (treeJson?.meta?.basePriceCents !== undefined) ? Number(treeJson.meta.basePriceCents) : undefined;

  // Prevent Enter key from submitting parent form when editing within PBV2 builder
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
      // Only prevent if it's not the Save/Publish buttons (they should submit)
      const target = e.target as HTMLElement;
      if (!target.closest('button[type="submit"]')) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  };

  return (
    <div 
      className="w-full h-full flex flex-col bg-[#0a0e1a]"
      onKeyDown={handleKeyDown}
    >
      {/* Fixed header */}
      <ProductHeader
        productName={editorModel.productMeta.name}
        productStatus={editorModel.productMeta.status}
        hasUnsavedChanges={hasUnsavedChanges}
        canPublish={canPublish}
        baseWeightOz={baseWeightOz}
        basePriceCents={basePriceCents}
        onSave={onSave}
        onPublish={onPublish}
        onExportJson={onExportJson}
        onImportJson={onImportJson}
        onUpdateProductName={(name) => onUpdateProduct({ name })}
        onUpdateBaseWeight={onUpdateBaseWeight}
        onUpdateBasePrice={onUpdateBasePrice}
      />
      
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
            allGroups={editorModel.groups}
            selectedOptionId={selectedOptionId}
            onSelectOption={onSelectOption}
            onAddOption={onAddOption}
            onDuplicateOption={onDuplicateOption}
            onDeleteOption={onDeleteOption}
            onReorderOption={onReorderOption}
            onMoveOption={onMoveOption}
            onUpdateGroup={onUpdateGroup}
            treeJson={treeJson}
            onUpdateOption={onUpdateOption}
            onAddChoice={onAddChoice}
            onUpdateChoice={onUpdateChoice}
            onDeleteChoice={onDeleteChoice}
            onReorderChoice={onReorderChoice}
            onAddWeightImpact={onAddWeightImpact}
            onUpdateWeightImpact={onUpdateWeightImpact}
            onDeleteWeightImpact={onDeleteWeightImpact}
            onAddPricingImpact={onAddPricingImpact}
            onUpdatePricingImpact={onUpdatePricingImpact}
            onDeletePricingImpact={onDeletePricingImpact}
            onUpdateChoicePriceDelta={onUpdateChoicePriceDelta}
          />
        </div>
        
        {/* Right Panel: Fixed width (384px), shrink-0 prevents it from shrinking */}
        <div className="w-96 shrink-0 overflow-hidden">
          <PricingValidationPanel
            findings={findings}
            publishAttempted={publishAttempted}
            pricingPreview={pricingPreview}
            weightPreview={weightPreview}
          />
        </div>
      </div>
    </div>
  );
}
