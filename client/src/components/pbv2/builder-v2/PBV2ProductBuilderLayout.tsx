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
  
  // Handlers
  onSelectGroup: (groupId: string) => void;
  onSelectOption: (optionId: string | null) => void;
  onAddGroup: () => void;
  onDeleteGroup: (groupId: string) => void;
  onAddOption: (groupId: string) => void;
  onDeleteOption: (groupId: string, optionId: string) => void;
  onUpdateGroup: (groupId: string, updates: any) => void;
  onUpdateProduct: (updates: any) => void;
  onSave: () => void;
  onPublish: () => void;
  onExportJson: () => void;
  onImportJson: () => void;
}

/**
 * Presentational 3-column layout for PBV2 builder.
 * This component receives all data and handlers from the container.
 */
export function PBV2ProductBuilderLayout({
  editorModel,
  selectedGroupId,
  selectedOptionId,
  hasUnsavedChanges,
  canPublish,
  findings,
  pricingPreview,
  onSelectGroup,
  onSelectOption,
  onAddGroup,
  onDeleteGroup,
  onAddOption,
  onDeleteOption,
  onUpdateGroup,
  onUpdateProduct,
  onSave,
  onPublish,
  onExportJson,
  onImportJson,
}: PBV2ProductBuilderLayoutProps) {
  const selectedGroup = editorModel.groups.find(g => g.id === selectedGroupId);

  return (
    <div className="h-screen flex flex-col bg-[#0a0e1a]">
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
      
      <div className="flex-1 flex overflow-hidden">
        <OptionGroupsSidebar
          optionGroups={editorModel.groups}
          options={editorModel.options}
          selectedGroupId={selectedGroupId}
          onSelectGroup={onSelectGroup}
          onAddGroup={onAddGroup}
          onDeleteGroup={onDeleteGroup}
        />
        
        <OptionEditor
          selectedGroup={selectedGroup}
          options={editorModel.options}
          selectedOptionId={selectedOptionId}
          onSelectOption={onSelectOption}
          onAddOption={onAddOption}
          onDeleteOption={onDeleteOption}
          onUpdateGroup={onUpdateGroup}
        />
        
        <PricingValidationPanel
          findings={findings}
          pricingPreview={pricingPreview}
        />
      </div>
    </div>
  );
}
