import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Loader2, Check, ChevronsUpDown, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { Product, ProductVariant } from "@shared/schema";
import type { OptionSelection } from "../types";
import { ProductOptionsPanel } from "./ProductOptionsPanel";

type LineItemBuilderProps = {
    products: Product[];
    selectedProductId: string;
    selectedProduct: Product | null;
    selectedVariantId: string | null;
    productVariants: ProductVariant[];
    width: string;
    height: string;
    quantity: string;
    calculatedPrice: number | null;
    isCalculating: boolean;
    calcError: string | null;
    optionSelections: Record<string, OptionSelection>;
    lineItemNotes: string;
    requiresDimensions: boolean;
    productOptions: any[];
    hasAttachmentOption: boolean;
    productSearchOpen: boolean;
    productSearchQuery: string;
    filteredProducts: Product[];
    onProductSelect: (id: string) => void;
    onVariantSelect: (id: string | null) => void;
    onWidthChange: (w: string) => void;
    onHeightChange: (h: string) => void;
    onQuantityChange: (q: string) => void;
    onOptionSelectionsChange: (selections: Record<string, OptionSelection>) => void;
    onLineItemNotesChange: (notes: string) => void;
    onAddLineItem: (pendingAttachments?: File[]) => void;
    onProductSearchOpenChange: (open: boolean) => void;
    onProductSearchQueryChange: (query: string) => void;
};

export function LineItemBuilder({
    products,
    selectedProductId,
    selectedProduct,
    selectedVariantId,
    productVariants,
    width,
    height,
    quantity,
    calculatedPrice,
    isCalculating,
    calcError,
    optionSelections,
    lineItemNotes,
    requiresDimensions,
    productOptions,
    hasAttachmentOption,
    productSearchOpen,
    productSearchQuery,
    filteredProducts,
    onProductSelect,
    onVariantSelect,
    onWidthChange,
    onHeightChange,
    onQuantityChange,
    onOptionSelectionsChange,
    onLineItemNotesChange,
    onAddLineItem,
    onProductSearchOpenChange,
    onProductSearchQueryChange,
}: LineItemBuilderProps) {
    const { toast } = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);

    // Max file size: 50MB
    const MAX_SIZE_BYTES = 50 * 1024 * 1024;

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;

        const filesToAdd = Array.from(e.target.files);

        // Check file sizes
        const oversizedFiles = filesToAdd.filter(f => f.size > MAX_SIZE_BYTES);
        if (oversizedFiles.length > 0) {
            toast({
                title: "File Too Large",
                description: "Files larger than 50MB cannot be uploaded.",
                variant: "destructive",
            });
            const validFiles = filesToAdd.filter(f => f.size <= MAX_SIZE_BYTES);
            if (validFiles.length === 0) {
                if (fileInputRef.current) fileInputRef.current.value = "";
                return;
            }
        }

        const validFiles = filesToAdd.filter(f => f.size <= MAX_SIZE_BYTES);
        setPendingAttachments(prev => [...prev, ...validFiles]);

        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    const handleRemoveFile = (index: number) => {
        setPendingAttachments(prev => prev.filter((_, i) => i !== index));
    };

    const handleAddClick = () => {
        onAddLineItem(pendingAttachments.length > 0 ? pendingAttachments : undefined);
        setPendingAttachments([]);
    };

    // Derived UI states for pricing clarity
    const hasPrice = calculatedPrice !== null;
    const showRecalc = isCalculating && hasPrice;
    const showCalculating = isCalculating && !hasPrice;
    const canSubmit = hasPrice && !isCalculating;

    return (
        <Card className="rounded-xl bg-card/80 border-border/60 shadow-md">
            <CardHeader className="pb-2 px-5 pt-4">
                <CardTitle className="text-sm font-medium">Add Line Item</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-5 pb-4">
                {/* Product & Variant selectors in a row */}
                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <Label className="text-xs">Product</Label>
                        <Popover open={productSearchOpen} onOpenChange={onProductSearchOpenChange}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    role="combobox"
                                    aria-expanded={productSearchOpen}
                                    className="h-9 w-full justify-between font-normal"
                                >
                                    {selectedProductId
                                        ? products?.find(p => p.id === selectedProductId)?.name || "Select product..."
                                        : "Select product..."}
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[300px] p-0" align="start">
                                <Command shouldFilter={false}>
                                    <CommandInput
                                        placeholder="Search products..."
                                        value={productSearchQuery}
                                        onValueChange={onProductSearchQueryChange}
                                    />
                                    <CommandList>
                                        <CommandEmpty>No products found.</CommandEmpty>
                                        <CommandGroup>
                                            {filteredProducts.map((product) => (
                                                <CommandItem
                                                    key={product.id}
                                                    value={product.id}
                                                    onSelect={() => onProductSelect(product.id)}
                                                >
                                                    <Check
                                                        className={cn(
                                                            "mr-2 h-4 w-4",
                                                            selectedProductId === product.id ? "opacity-100" : "opacity-0"
                                                        )}
                                                    />
                                                    <span className="truncate">{product.name}</span>
                                                    {(product as any).sku && (
                                                        <span className="ml-2 text-xs text-muted-foreground">
                                                            {(product as any).sku}
                                                        </span>
                                                    )}
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>
                    </div>

                    {productVariants && productVariants.filter(v => v.isActive).length > 0 ? (
                        <div className="space-y-1.5">
                            <Label className="text-xs">Variant</Label>
                            <Select value={selectedVariantId || ""} onValueChange={onVariantSelect}>
                                <SelectTrigger className="h-9">
                                    <SelectValue placeholder="Select variant" />
                                </SelectTrigger>
                                <SelectContent>
                                    {productVariants.filter(v => v.isActive).map((variant) => (
                                        <SelectItem key={variant.id} value={variant.id}>
                                            {variant.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    ) : (
                        <div /> /* Empty div to maintain grid */
                    )}
                </div>

                {/* Dimensions & Quantity row */}
                <div className="grid grid-cols-3 gap-3">
                    {requiresDimensions ? (
                        <>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Width (in)</Label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    value={width}
                                    onChange={(e) => onWidthChange(e.target.value)}
                                    className="h-9"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Height (in)</Label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    value={height}
                                    onChange={(e) => onHeightChange(e.target.value)}
                                    className="h-9"
                                />
                            </div>
                        </>
                    ) : selectedProductId ? (
                        <div className="col-span-2 flex items-end">
                            <p className="text-xs text-muted-foreground pb-2">No dimensions required for this product</p>
                        </div>
                    ) : (
                        <div className="col-span-2" />
                    )}
                    <div className="space-y-1.5">
                        <Label className="text-xs">Quantity</Label>
                        <Input
                            type="number"
                            min="1"
                            value={quantity}
                            onChange={(e) => onQuantityChange(e.target.value)}
                            className="h-9"
                        />
                    </div>
                </div>

                {/* Product Options */}
                {selectedProduct && productOptions.length > 0 && (
                    <ProductOptionsPanel
                        product={selectedProduct}
                        productOptions={productOptions}
                        optionSelections={optionSelections}
                        onOptionSelectionsChange={onOptionSelectionsChange}
                    />
                )}

                {/* Artwork / Attachments section */}
                {hasAttachmentOption && (
                    <div className="space-y-2 border-t pt-4">
                        <Label className="text-sm font-medium">Artwork / Attachments</Label>
                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            multiple
                            accept="image/*,.pdf,.ai,.eps,.psd,.svg"
                            onChange={handleFileSelect}
                        />
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full h-9"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <Upload className="w-4 h-4 mr-2" />
                            Select Files
                        </Button>

                        {/* Display selected files */}
                        {pendingAttachments.length > 0 && (
                            <div className="space-y-1.5">
                                {pendingAttachments.map((file, index) => (
                                    <div
                                        key={index}
                                        className="flex items-center gap-2 p-2 rounded bg-muted/50 text-sm"
                                    >
                                        <span className="flex-1 truncate">{file.name}</span>
                                        <span className="text-xs text-muted-foreground">
                                            {(file.size / 1024 / 1024).toFixed(1)} MB
                                        </span>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                                            onClick={() => handleRemoveFile(index)}
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Line Item Notes */}
                <div className="space-y-1.5">
                    <Label className="text-xs">Line Item Notes</Label>
                    <Textarea
                        placeholder="Special instructions for this item..."
                        value={lineItemNotes}
                        onChange={(e) => onLineItemNotesChange(e.target.value)}
                        rows={2}
                        className="text-sm resize-none"
                    />
                </div>

                {/* Price display and Add button */}
                <div className="flex items-center justify-between pt-2 border-t">
                    <div className="flex flex-col gap-1">
                        {/* Price display with state-driven clarity */}
                        {hasPrice ? (
                            <div className="flex items-center gap-2">
                                <div className="text-lg font-semibold font-mono">
                                    ${calculatedPrice.toFixed(2)}
                                </div>
                                {showRecalc && (
                                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        <span>recalculating...</span>
                                    </div>
                                )}
                            </div>
                        ) : showCalculating ? (
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span className="text-sm">Calculating...</span>
                            </div>
                        ) : (
                            <div className="text-sm text-muted-foreground">—</div>
                        )}
                        
                        {/* Error message (show below price if price exists) */}
                        {calcError && (
                            <span className="text-xs text-destructive">{calcError}</span>
                        )}
                    </div>
                    <Button
                        type="button"
                        onClick={handleAddClick}
                        disabled={!canSubmit}
                        className="gap-2"
                    >
                        <Plus className="w-4 h-4" />
                        Add Item
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
