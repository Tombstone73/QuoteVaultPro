import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ProductOptionItem } from "@shared/schema";
import type { OptionSelection } from "../types";
import { formatOptionPriceLabel } from "../utils";

type ProductOptionsPanelProps = {
    productOptions: ProductOptionItem[];
    optionSelections: Record<string, OptionSelection>;
    width: string;
    height: string;
    quantity: string;
    requiresDimensions: boolean;
    onOptionSelectionsChange: (selections: Record<string, OptionSelection>) => void;
};

export function ProductOptionsPanel({
    productOptions,
    optionSelections,
    onOptionSelectionsChange,
}: ProductOptionsPanelProps) {
    // Filter out attachment options (handled separately)
    const visibleOptions = productOptions.filter((option) => option.type !== "attachment");

    if (visibleOptions.length === 0) {
        return null;
    }

    return (
        <div className="space-y-3 border-t pt-4">
            <Label className="text-sm font-medium">Product Options</Label>
            <div className="grid gap-2">
                {visibleOptions.map((option) => {
                    const selection = optionSelections[option.id];
                    const isSelected = !!selection;

                    return (
                        <div key={option.id} className="p-3 border rounded-md space-y-2">
                            {/* Checkbox type */}
                            {option.type === "checkbox" && (
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Switch
                                            checked={isSelected}
                                            onCheckedChange={(checked) => {
                                                if (checked) {
                                                    onOptionSelectionsChange({
                                                        ...optionSelections,
                                                        [option.id]: { value: true }
                                                    });
                                                } else {
                                                    const { [option.id]: _, ...rest } = optionSelections;
                                                    onOptionSelectionsChange(rest);
                                                }
                                            }}
                                        />
                                        <Label className="cursor-pointer text-sm">{option.label}</Label>
                                    </div>
                                    {option.amount != null && (
                                        <Badge variant="secondary" className="text-xs">
                                            {formatOptionPriceLabel(option)}
                                        </Badge>
                                    )}
                                </div>
                            )}

                            {/* Quantity type */}
                            {option.type === "quantity" && (
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label className="text-sm">{option.label}</Label>
                                        {option.amount != null && (
                                            <Badge variant="secondary" className="text-xs">
                                                {formatOptionPriceLabel(option)}
                                            </Badge>
                                        )}
                                    </div>
                                    <Input
                                        type="number"
                                        min="0"
                                        value={typeof selection?.value === "number" ? selection.value : 0}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value) || 0;
                                            if (val > 0) {
                                                onOptionSelectionsChange({
                                                    ...optionSelections,
                                                    [option.id]: { value: val }
                                                });
                                            } else {
                                                const { [option.id]: _, ...rest } = optionSelections;
                                                onOptionSelectionsChange(rest);
                                            }
                                        }}
                                        className="h-8"
                                    />
                                </div>
                            )}

                            {/* Toggle type (for sides: single/double) */}
                            {option.type === "toggle" && option.config?.kind === "sides" && (
                                <div className="space-y-2">
                                    <Label className="text-sm">{option.label}</Label>
                                    <div className="flex gap-2">
                                        <Button
                                            type="button"
                                            variant={selection?.value === "single" ? "default" : "outline"}
                                            size="sm"
                                            className="flex-1"
                                            onClick={() => {
                                                onOptionSelectionsChange({
                                                    ...optionSelections,
                                                    [option.id]: { value: "single" }
                                                });
                                            }}
                                        >
                                            {option.config.singleLabel || "Single"}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant={selection?.value === "double" ? "default" : "outline"}
                                            size="sm"
                                            className="flex-1"
                                            onClick={() => {
                                                onOptionSelectionsChange({
                                                    ...optionSelections,
                                                    [option.id]: { value: "double" }
                                                });
                                            }}
                                        >
                                            {option.config.doubleLabel || "Double"}
                                            {option.config.pricingMode !== "volume" && option.config.doublePriceMultiplier && (
                                                <span className="ml-1 text-xs">({option.config.doublePriceMultiplier}x)</span>
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {/* Generic toggle (not sides) */}
                            {option.type === "toggle" && option.config?.kind !== "sides" && (
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Switch
                                            checked={isSelected}
                                            onCheckedChange={(checked) => {
                                                if (checked) {
                                                    onOptionSelectionsChange({
                                                        ...optionSelections,
                                                        [option.id]: { value: true }
                                                    });
                                                } else {
                                                    const { [option.id]: _, ...rest } = optionSelections;
                                                    onOptionSelectionsChange(rest);
                                                }
                                            }}
                                        />
                                        <Label className="cursor-pointer text-sm">{option.label}</Label>
                                    </div>
                                    {option.amount != null && (
                                        <Badge variant="secondary" className="text-xs">
                                            {formatOptionPriceLabel(option)}
                                        </Badge>
                                    )}
                                </div>
                            )}

                            {/* Grommets with location selector */}
                            {option.config?.kind === "grommets" && isSelected && (
                                <div className="space-y-2 mt-2 pl-4 border-l-2 border-orange-500">
                                    {option.config.spacingOptions && option.config.spacingOptions.length > 0 && (
                                        <div className="space-y-1">
                                            <Label className="text-xs">Grommet Spacing</Label>
                                            <Select
                                                value={String(selection?.grommetsSpacingInches || option.config.defaultSpacingInches || option.config.spacingOptions[0])}
                                                onValueChange={(val) => {
                                                    onOptionSelectionsChange({
                                                        ...optionSelections,
                                                        [option.id]: {
                                                            ...optionSelections[option.id],
                                                            grommetsSpacingInches: parseInt(val)
                                                        }
                                                    });
                                                }}
                                            >
                                                <SelectTrigger className="h-8">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {option.config.spacingOptions.map((sp: number) => (
                                                        <SelectItem key={sp} value={String(sp)}>{sp}" spacing</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )}
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-1">
                                            <Label className="text-xs">Per Sign</Label>
                                            <Input
                                                type="number"
                                                min="0"
                                                value={selection?.grommetsPerSign ?? 4}
                                                onChange={(e) => {
                                                    const count = parseInt(e.target.value) || 0;
                                                    onOptionSelectionsChange({
                                                        ...optionSelections,
                                                        [option.id]: {
                                                            ...optionSelections[option.id],
                                                            grommetsPerSign: count
                                                        }
                                                    });
                                                }}
                                                className="h-8"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">Location</Label>
                                            <Select
                                                value={selection?.grommetsLocation || option.config.defaultLocation || "all_corners"}
                                                onValueChange={(val) => {
                                                    let defaultCount = selection?.grommetsPerSign;
                                                    if (!defaultCount) {
                                                        if (val === "all_corners") defaultCount = 4;
                                                        else if (val === "top_corners") defaultCount = 2;
                                                        else defaultCount = 4;
                                                    }
                                                    onOptionSelectionsChange({
                                                        ...optionSelections,
                                                        [option.id]: {
                                                            ...optionSelections[option.id],
                                                            grommetsLocation: val,
                                                            grommetsPerSign: defaultCount
                                                        }
                                                    });
                                                }}
                                            >
                                                <SelectTrigger className="h-8">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="all_corners">All Corners</SelectItem>
                                                    <SelectItem value="top_corners">Top Corners</SelectItem>
                                                    <SelectItem value="top_even">Top Edge Even</SelectItem>
                                                    <SelectItem value="custom">Custom</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                    {selection?.grommetsLocation === "custom" && (
                                        <Textarea
                                            placeholder="Custom placement notes..."
                                            value={selection?.customPlacementNote || ""}
                                            onChange={(e) => {
                                                onOptionSelectionsChange({
                                                    ...optionSelections,
                                                    [option.id]: {
                                                        ...optionSelections[option.id],
                                                        customPlacementNote: e.target.value
                                                    }
                                                });
                                            }}
                                            rows={2}
                                            className="text-xs"
                                        />
                                    )}
                                </div>
                            )}

                            {/* Hems option */}
                            {option.config?.kind === "hems" && isSelected && (
                                <div className="space-y-1 mt-2 pl-4 border-l-2 border-blue-500">
                                    <Label className="text-xs">Hem Style</Label>
                                    <Select
                                        value={selection?.hemsType || option.config.defaultHems || "none"}
                                        onValueChange={(val) => {
                                            onOptionSelectionsChange({
                                                ...optionSelections,
                                                [option.id]: {
                                                    ...optionSelections[option.id],
                                                    hemsType: val
                                                }
                                            });
                                        }}
                                    >
                                        <SelectTrigger className="h-8">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {(option.config.hemsChoices || ["none", "all_sides", "top_bottom", "left_right"]).map((choice: string) => (
                                                <SelectItem key={choice} value={choice}>
                                                    {choice === "none" ? "None" :
                                                        choice === "all_sides" ? "All Sides" :
                                                            choice === "top_bottom" ? "Top & Bottom" :
                                                                choice === "left_right" ? "Left & Right" : choice}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}

                            {/* Pole Pockets option */}
                            {option.config?.kind === "pole_pockets" && isSelected && (
                                <div className="space-y-1 mt-2 pl-4 border-l-2 border-green-500">
                                    <Label className="text-xs">Pole Pocket Location</Label>
                                    <Select
                                        value={selection?.polePocket || option.config.defaultPolePocket || "none"}
                                        onValueChange={(val) => {
                                            onOptionSelectionsChange({
                                                ...optionSelections,
                                                [option.id]: {
                                                    ...optionSelections[option.id],
                                                    polePocket: val
                                                }
                                            });
                                        }}
                                    >
                                        <SelectTrigger className="h-8">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {(option.config.polePocketChoices || ["none", "top", "bottom", "top_bottom"]).map((choice: string) => (
                                                <SelectItem key={choice} value={choice}>
                                                    {choice === "none" ? "None" :
                                                        choice === "top" ? "Top" :
                                                            choice === "bottom" ? "Bottom" :
                                                                choice === "top_bottom" ? "Top & Bottom" : choice}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
