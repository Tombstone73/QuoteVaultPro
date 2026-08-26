import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TitanCard } from "@/components/titan";
import type { GlobalVariable } from "@shared/schema";
import { DEFAULT_DOCUMENT_NUMBER_PREFIXES, sanitizeDocumentNumberPrefix } from "@shared/documentNumbering";
import { normalizeSystemSetupSequenceValue } from "@/lib/systemSetupSettings";

const SEQUENCES = [
  { varName: "next_purchase_order_number", label: "Purchase Order Number", description: "Next purchase order number sequence (auto-initialized)" },
] as const;

const PREFIXES = [
  { varName: "quote_number_prefix", label: "Quote Prefix", defaultValue: DEFAULT_DOCUMENT_NUMBER_PREFIXES.quote },
  { varName: "order_number_prefix", label: "Order Prefix", defaultValue: DEFAULT_DOCUMENT_NUMBER_PREFIXES.order },
  { varName: "invoice_number_prefix", label: "Invoice Prefix", defaultValue: DEFAULT_DOCUMENT_NUMBER_PREFIXES.invoice },
  { varName: "purchase_order_number_prefix", label: "Purchase Order Prefix", defaultValue: DEFAULT_DOCUMENT_NUMBER_PREFIXES.purchase_order },
] as const;

function NumberSequenceCard({ varName, label, description }: { varName: string; label: string; description: string }) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [newValue, setNewValue] = useState("");

  const { data: globalVariables, isLoading } = useQuery<GlobalVariable[]>({
    queryKey: ["/api/global-variables"],
  });

  const varEntry = globalVariables?.find((v) => v.name === varName);
  const currentNumber = varEntry ? String(varEntry.value ?? "") : null;

  const updateMutation = useMutation({
    mutationFn: async (value: string) => {
      if (varEntry) return apiRequest("PATCH", `/api/global-variables/${varEntry.id}`, { value });
      return apiRequest("POST", "/api/global-variables", {
        name: varName,
        value,
        description,
        category: "numbering",
        isActive: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/global-variables"] });
      setIsEditing(false);
      setNewValue("");
      toast({ title: `${label} updated` });
    },
    onError: (error: Error) => {
      toast({ title: `Failed to update ${label.toLowerCase()}`, description: error.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    let normalizedValue = "";
    try {
      normalizedValue = normalizeSystemSetupSequenceValue(newValue);
    } catch (error: any) {
      toast({ title: "Invalid number", description: error?.message || "Please enter a valid positive number.", variant: "destructive" });
      return;
    }
    updateMutation.mutate(normalizedValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") { setIsEditing(false); setNewValue(""); }
  };

  return (
    // noPadding: we own all padding inside the grid so nothing fights us
    <TitanCard noPadding>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: "56px",
          padding: "0 12px",
          gap: "10px",
        }}
      >
        {/* Label — left, muted, truncates */}
        <span
          style={{
            fontSize: "12px",
            color: "var(--muted-foreground, #888)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flexShrink: 1,
            minWidth: 0,
          }}
        >
          {label}
        </span>

        {/* Value / Input — sits right next to label */}
        {isLoading ? (
          <Skeleton className="h-4 w-10 shrink-0" />
        ) : isEditing ? (
          <Input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={currentNumber ?? "1000"}
            className="h-7 text-xs px-1 shrink-0"
            style={{ width: "104px", textAlign: "right" }}
            autoFocus
          />
        ) : (
          <span
            style={{
              fontSize: "13px",
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {currentNumber ?? "—"}
          </span>
        )}

        {/* Spacer pushes button to the right */}
        <div style={{ flex: 1 }} />

        {/* Action — pinned right */}
        <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
          {isEditing ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                style={{ padding: "0 6px", minWidth: 0 }}
                onClick={() => { setIsEditing(false); setNewValue(""); }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                style={{ padding: "0 8px", minWidth: 0 }}
                onClick={handleSave}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? "…" : "Save"}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              style={{ width: "80px" }}
              onClick={() => { setIsEditing(true); setNewValue(currentNumber ?? "1000"); }}
            >
              Change
            </Button>
          )}
        </div>
      </div>
    </TitanCard>
  );
}

function PrefixCard({ varName, label, defaultValue }: { varName: string; label: string; defaultValue: string }) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [newValue, setNewValue] = useState("");

  const { data: globalVariables, isLoading } = useQuery<GlobalVariable[]>({
    queryKey: ["/api/global-variables"],
  });

  const varEntry = globalVariables?.find((v) => v.name === varName);
  const currentPrefix = varEntry ? String(varEntry.value ?? "") : defaultValue;

  const updateMutation = useMutation({
    mutationFn: async (prefix: string) => {
      if (varEntry) {
        return apiRequest("PATCH", `/api/global-variables/${varEntry.id}`, { value: prefix });
      }
      return apiRequest("POST", "/api/global-variables", {
        name: varName,
        value: prefix,
        description: `${label} setting`,
        category: "numbering",
        isActive: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/global-variables"] });
      setIsEditing(false);
      setNewValue("");
      toast({ title: `${label} updated` });
    },
    onError: (error: Error) => {
      toast({ title: `Failed to update ${label.toLowerCase()}`, description: error.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    let prefix = "";
    try {
      prefix = sanitizeDocumentNumberPrefix(newValue);
    } catch (error: any) {
      toast({ title: "Invalid prefix", description: error?.message || "Use letters, numbers, dashes, or underscores.", variant: "destructive" });
      return;
    }
    updateMutation.mutate(prefix);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") { setIsEditing(false); setNewValue(""); }
  };

  return (
    <TitanCard noPadding>
      <div style={{ display: "flex", alignItems: "center", height: "56px", padding: "0 12px", gap: "10px" }}>
        <span style={{ fontSize: "12px", color: "var(--muted-foreground, #888)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 1, minWidth: 0 }}>
          {label}
        </span>
        {isLoading ? (
          <Skeleton className="h-4 w-10 shrink-0" />
        ) : isEditing ? (
          <Input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={defaultValue || "No prefix"}
            className="h-7 text-xs px-1 shrink-0"
            style={{ width: "104px", textAlign: "right" }}
            maxLength={16}
            autoFocus
          />
        ) : (
          <span style={{ fontSize: "13px", fontWeight: 600, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", flexShrink: 0 }}>
            {currentPrefix || "No prefix"}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
          {isEditing ? (
            <>
              <Button size="sm" variant="ghost" className="h-7 text-xs" style={{ padding: "0 6px", minWidth: 0 }} onClick={() => { setIsEditing(false); setNewValue(""); }}>
                Cancel
              </Button>
              <Button size="sm" className="h-7 text-xs" style={{ padding: "0 8px", minWidth: 0 }} onClick={handleSave} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "..." : "Save"}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" className="h-7 text-xs" style={{ width: "80px" }} onClick={() => { setIsEditing(true); setNewValue(currentPrefix); }}>
              Change
            </Button>
          )}
        </div>
      </div>
    </TitanCard>
  );
}

export default function SetupSettings() {
  return (
    <div className="space-y-4">
      <TitanCard className="p-4">
        <h2 className="text-titan-lg font-semibold text-titan-text-primary">System Setup</h2>
        <p className="text-titan-sm text-titan-text-secondary mt-1">
          Foundational settings configured at launch. Changes affect future records only —
          existing documents are never renumbered.
        </p>
      </TitanCard>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        {/* Label card */}
        <TitanCard noPadding>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              height: "56px",
              padding: "0 12px",
            }}
          >
            <span style={{ fontSize: "12px", color: "var(--muted-foreground, #888)", lineHeight: "1.4" }}>
              Quote/Order/Invoice/Purchase Order starting numbers
            </span>
          </div>
        </TitanCard>

        {SEQUENCES.map(({ varName, label, description }) => (
          <NumberSequenceCard key={varName} varName={varName} label={label} description={description} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        <TitanCard noPadding>
          <div style={{ display: "flex", alignItems: "center", height: "56px", padding: "0 12px" }}>
            <span style={{ fontSize: "12px", color: "var(--muted-foreground, #888)", lineHeight: "1.4" }}>
              Quote/Order/Invoice/Purchase Order prefixes
            </span>
          </div>
        </TitanCard>

        {PREFIXES.map(({ varName, label, defaultValue }) => (
          <PrefixCard key={varName} varName={varName} label={label} defaultValue={defaultValue} />
        ))}
      </div>
    </div>
  );
}
