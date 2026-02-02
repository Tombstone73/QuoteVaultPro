import React, { useState } from 'react';
import { ProductHeader } from '@/app/components/ProductHeader';
import { OptionGroupsSidebar } from '@/app/components/OptionGroupsSidebar';
import { OptionEditor } from '@/app/components/OptionEditor';
import { PricingValidationPanel } from '@/app/components/PricingValidationPanel';
import { ConfirmationModal } from '@/app/components/ConfirmationModal';
import { mockProduct } from '@/app/data/mockData';
import type { Product, OptionGroup, Option } from '@/app/types';

export default function App() {
  const [product, setProduct] = useState<Product>(mockProduct);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    product.optionGroups[0]?.id || null
  );
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [deleteGroupModal, setDeleteGroupModal] = useState<{ open: boolean; groupId: string | null; groupName: string }>({
    open: false,
    groupId: null,
    groupName: ''
  });

  const selectedGroup = product.optionGroups.find(g => g.id === selectedGroupId);
  const selectedOption = selectedGroup?.options.find(o => o.id === selectedOptionId);

  const handleSave = () => {
    console.log('Saving product...', product);
    setHasUnsavedChanges(false);
  };

  const handlePublish = () => {
    console.log('Publishing product...', product);
    setProduct({ ...product, status: 'active' });
    setHasUnsavedChanges(false);
  };

  const handleUpdateProduct = (updates: Partial<Product>) => {
    setProduct({ ...product, ...updates });
    setHasUnsavedChanges(true);
  };

  const handleUpdateGroup = (groupId: string, updates: Partial<OptionGroup>) => {
    setProduct({
      ...product,
      optionGroups: product.optionGroups.map(g =>
        g.id === groupId ? { ...g, ...updates } : g
      )
    });
    setHasUnsavedChanges(true);
  };

  const handleUpdateOption = (groupId: string, optionId: string, updates: Partial<Option>) => {
    setProduct({
      ...product,
      optionGroups: product.optionGroups.map(g =>
        g.id === groupId
          ? {
              ...g,
              options: g.options.map(o =>
                o.id === optionId ? { ...o, ...updates } : o
              )
            }
          : g
      )
    });
    setHasUnsavedChanges(true);
  };

  const handleAddGroup = () => {
    const newGroup: OptionGroup = {
      id: `group-${Date.now()}`,
      name: 'New Option Group',
      description: '',
      sortOrder: product.optionGroups.length,
      isRequired: false,
      isMultiSelect: false,
      options: []
    };
    setProduct({
      ...product,
      optionGroups: [...product.optionGroups, newGroup]
    });
    setSelectedGroupId(newGroup.id);
    setHasUnsavedChanges(true);
  };

  const handleAddOption = (groupId: string) => {
    const newOption: Option = {
      id: `option-${Date.now()}`,
      name: 'New Option',
      description: '',
      type: 'radio',
      sortOrder: selectedGroup?.options.length || 0,
      isDefault: false,
      isRequired: false,
      pricingBehavior: {
        type: 'none'
      },
      weightImpact: {
        enabled: false,
        type: 'fixed',
        value: 0
      },
      productionFlags: [],
      conditionalLogic: null
    };
    
    setProduct({
      ...product,
      optionGroups: product.optionGroups.map(g =>
        g.id === groupId
          ? { ...g, options: [...g.options, newOption] }
          : g
      )
    });
    setSelectedOptionId(newOption.id);
    setHasUnsavedChanges(true);
  };

  const handleRequestDeleteGroup = (groupId: string) => {
    const group = product.optionGroups.find(g => g.id === groupId);
    if (group) {
      setDeleteGroupModal({
        open: true,
        groupId: groupId,
        groupName: group.name
      });
    }
  };

  const handleConfirmDeleteGroup = () => {
    if (deleteGroupModal.groupId) {
      setProduct({
        ...product,
        optionGroups: product.optionGroups.filter(g => g.id !== deleteGroupModal.groupId)
      });
      if (selectedGroupId === deleteGroupModal.groupId) {
        setSelectedGroupId(product.optionGroups[0]?.id || null);
      }
      setHasUnsavedChanges(true);
    }
  };

  const handleDeleteOption = (groupId: string, optionId: string) => {
    setProduct({
      ...product,
      optionGroups: product.optionGroups.map(g =>
        g.id === groupId
          ? { ...g, options: g.options.filter(o => o.id !== optionId) }
          : g
      )
    });
    if (selectedOptionId === optionId) {
      setSelectedOptionId(null);
    }
    setHasUnsavedChanges(true);
  };

  const handleRenameGroup = (groupId: string) => {
    setSelectedGroupId(groupId);
  };

  return (
    <div className="flex h-screen flex-col bg-[#0a0e1a]">
      <ProductHeader
        product={product}
        hasUnsavedChanges={hasUnsavedChanges}
        onSave={handleSave}
        onPublish={handlePublish}
        onUpdateProduct={handleUpdateProduct}
      />
      
      <div className="flex flex-1 overflow-hidden">
        <OptionGroupsSidebar
          optionGroups={product.optionGroups}
          selectedGroupId={selectedGroupId}
          onSelectGroup={setSelectedGroupId}
          onAddGroup={handleAddGroup}
          onDeleteGroup={handleRequestDeleteGroup}
          onUpdateGroup={handleUpdateGroup}
          onRenameGroup={handleRenameGroup}
        />
        
        <main className="flex-1 overflow-y-auto border-r border-[#334155]">
          <OptionEditor
            selectedGroup={selectedGroup}
            selectedOption={selectedOption}
            product={product}
            onSelectOption={setSelectedOptionId}
            onAddOption={handleAddOption}
            onUpdateOption={handleUpdateOption}
            onDeleteOption={handleDeleteOption}
            onUpdateGroup={handleUpdateGroup}
            onUpdateProduct={handleUpdateProduct}
          />
        </main>
        
        <PricingValidationPanel product={product} />
      </div>

      <ConfirmationModal
        open={deleteGroupModal.open}
        onOpenChange={(open) => setDeleteGroupModal({ open, groupId: null, groupName: '' })}
        title={`Delete option group "${deleteGroupModal.groupName}"?`}
        description={`This will remove this option group and all options inside it.\nAny related pricing, logic, or validation rules will also be removed.\n\nThis action cannot be undone.`}
        confirmLabel="Delete group"
        onConfirm={handleConfirmDeleteGroup}
      />
    </div>
  );
}
