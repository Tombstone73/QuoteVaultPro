import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Library, Loader2, Search, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type TemplateRecord = {
  id: string;
  name: string;
  category: string;
  slug: string;
  description?: string | null;
  tags?: string[];
  difficultyLevel?: string | null;
  isSystemTemplate: boolean;
  workflowMetadata?: Record<string, unknown>;
  pricingMetadata?: Record<string, unknown>;
  intentMetadata?: Record<string, unknown>;
  previewConfig?: Record<string, unknown>;
};

type TemplateListEnvelope = {
  success: boolean;
  data?: { templates?: TemplateRecord[] };
  message?: string;
};

async function fetchTemplates(params: { q: string; category: string; scope: string }): Promise<TemplateRecord[]> {
  const search = new URLSearchParams();
  if (params.q.trim()) search.set("q", params.q.trim());
  if (params.category && params.category !== "all") search.set("category", params.category);
  if (params.scope) search.set("scope", params.scope);
  const res = await fetch(`/api/pbv2/option-group-templates?${search.toString()}`, { credentials: "include" });
  const json = await res.json().catch(() => null) as TemplateListEnvelope | null;
  if (!res.ok || !json?.success) throw new Error(json?.message ?? "Failed to load templates");
  return json.data?.templates ?? [];
}

function splitCsv(value: string): string[] {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function textFromMetadata(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(String).join(", ");
  return "";
}

export function TemplateLibraryDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (templateId: string) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [scope, setScope] = useState("all");
  const [importingId, setImportingId] = useState<string | null>(null);
  const { data: templates = [], isLoading, error } = useQuery({
    queryKey: ["pbv2-option-group-templates", q, category, scope],
    queryFn: () => fetchTemplates({ q, category, scope }),
    enabled: open,
  });

  const categories = useMemo(() => {
    const values = Array.from(new Set(templates.map((template) => template.category).filter(Boolean)));
    return values.sort((a, b) => a.localeCompare(b));
  }, [templates]);

  const handleImport = async (templateId: string) => {
    setImportingId(templateId);
    try {
      await onImport(templateId);
      onOpenChange(false);
    } catch {
      // Parent handler owns the toast; keep the dialog open for retry.
    } finally {
      setImportingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl bg-[#1e293b] border-[#334155] text-slate-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Library className="h-5 w-5 text-blue-300" />
            Option Group Templates
          </DialogTitle>
          <DialogDescription className="text-slate-300">
            Reusable PBV2 blueprints import as detached draft groups.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-[1fr_180px_180px]">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <Input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search templates"
              className="pl-9 bg-slate-950/40 border-slate-700 text-slate-100"
            />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="bg-slate-950/40 border-slate-700 text-slate-100">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((entry) => (
                <SelectItem key={entry} value={entry}>{entry}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="bg-slate-950/40 border-slate-700 text-slate-100">
              <SelectValue placeholder="Scope" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All templates</SelectItem>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="organization">Organization</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <ScrollArea className="max-h-[520px] pr-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-14 text-slate-300">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading templates
            </div>
          ) : error ? (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
              {(error as Error).message}
            </div>
          ) : templates.length === 0 ? (
            <div className="rounded-md border border-slate-700 bg-slate-950/30 p-6 text-center text-sm text-slate-300">
              No templates match the current filters.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {templates.map((template) => {
                const usedFor = textFromMetadata(template.previewConfig?.usedFor ?? template.intentMetadata?.intent);
                const workflow = textFromMetadata(template.previewConfig?.workflowImplications ?? template.intentMetadata?.productionImplications);
                const pricing = textFromMetadata(template.previewConfig?.pricingImplications ?? template.intentMetadata?.pricingBehavior);
                return (
                  <div key={template.id} className="rounded-md border border-slate-700 bg-slate-950/30 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-slate-100">{template.name}</h3>
                          <Badge variant="outline" className={template.isSystemTemplate ? "border-blue-400/50 text-blue-200" : "border-emerald-400/50 text-emerald-200"}>
                            {template.isSystemTemplate ? "System" : "Org"}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-slate-400">{template.category}{template.difficultyLevel ? ` - ${template.difficultyLevel}` : ""}</div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        className="bg-blue-600 hover:bg-blue-700"
                        disabled={importingId !== null}
                        onClick={() => handleImport(template.id)}
                      >
                        {importingId === template.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      </Button>
                    </div>
                    {template.description && <p className="mt-3 text-sm text-slate-300">{template.description}</p>}
                    {usedFor && <p className="mt-3 text-xs text-slate-400"><span className="text-slate-300">Used for:</span> {usedFor}</p>}
                    {workflow && <p className="mt-2 text-xs text-slate-400"><span className="text-slate-300">Workflow:</span> {workflow}</p>}
                    {pricing && <p className="mt-2 text-xs text-slate-400"><span className="text-slate-300">Pricing:</span> {pricing}</p>}
                    {Array.isArray(template.tags) && template.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {template.tags.slice(0, 6).map((tag) => (
                          <Badge key={tag} variant="outline" className="border-slate-600 text-slate-300 text-[10px]">{tag}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export function SaveOptionGroupTemplateDialog({
  open,
  groupName,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  groupName?: string;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Finishing");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [difficultyLevel, setDifficultyLevel] = useState("beginner");
  const [recommendedProductTypes, setRecommendedProductTypes] = useState("");
  const [usedFor, setUsedFor] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(groupName ?? "");
    setCategory("Finishing");
    setDescription("");
    setTags("");
    setDifficultyLevel("beginner");
    setRecommendedProductTypes("");
    setUsedFor("");
  }, [open, groupName]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        name,
        category,
        description: description || null,
        tags: splitCsv(tags),
        difficultyLevel,
        recommendedProductTypes: splitCsv(recommendedProductTypes),
        previewConfig: usedFor ? { usedFor } : {},
        intentMetadata: {
          intent: usedFor || description || `Reusable ${name} option group.`,
          onboardingNotes: usedFor ? [usedFor] : [],
        },
      });
      onOpenChange(false);
    } catch {
      // Parent handler owns the toast; keep the form state intact for retry.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#1e293b] border-[#334155] text-slate-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Save className="h-5 w-5 text-emerald-300" />
            Save Group As Template
          </DialogTitle>
          <DialogDescription className="text-slate-300">
            Creates an organization-owned blueprint from the current draft group.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="template-name">Name</Label>
            <Input id="template-name" value={name} onChange={(event) => setName(event.target.value)} className="bg-slate-950/40 border-slate-700" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="template-category">Category</Label>
              <Input id="template-category" value={category} onChange={(event) => setCategory(event.target.value)} className="bg-slate-950/40 border-slate-700" />
            </div>
            <div className="grid gap-2">
              <Label>Difficulty</Label>
              <Select value={difficultyLevel} onValueChange={setDifficultyLevel}>
                <SelectTrigger className="bg-slate-950/40 border-slate-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="beginner">Beginner</SelectItem>
                  <SelectItem value="intermediate">Intermediate</SelectItem>
                  <SelectItem value="advanced">Advanced</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="template-description">Description</Label>
            <Textarea id="template-description" value={description} onChange={(event) => setDescription(event.target.value)} className="bg-slate-950/40 border-slate-700" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="template-used-for">Used for</Label>
            <Input id="template-used-for" value={usedFor} onChange={(event) => setUsedFor(event.target.value)} className="bg-slate-950/40 border-slate-700" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="template-tags">Tags</Label>
              <Input id="template-tags" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="finishing, signage" className="bg-slate-950/40 border-slate-700" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="template-products">Product types</Label>
              <Input id="template-products" value={recommendedProductTypes} onChange={(event) => setRecommendedProductTypes(event.target.value)} placeholder="banners, decals" className="bg-slate-950/40 border-slate-700" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={handleSave} disabled={saving || !name.trim() || !category.trim()} className="bg-emerald-600 hover:bg-emerald-700">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
