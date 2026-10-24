import { useEffect, useState } from "react";
import { blankCoroplastPricingSchema, readBlankCoroplastPricing, withBlankCoroplastPricing } from "@shared/blankCoroplast";
import type { OptionTreeV2 } from "@shared/optionTreeV2";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type TierDraft = { minQuantity: string; rate: string };
const dollars = (cents: number) => (cents / 100).toFixed(2);
function cents(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const amount = Math.round(Number(value) * 100);
  return Number.isSafeInteger(amount) ? amount : null;
}

export function BlankCoroplastPricingEditor({ tree, productName, onUpdate }: {
  tree: OptionTreeV2; productName: string; onUpdate: (tree: OptionTreeV2) => void;
}) {
  const current = readBlankCoroplastPricing(tree);
  const [unit, setUnit] = useState<"per_square_foot" | "per_piece">(current?.unit ?? "per_square_foot");
  const [rate, setRate] = useState(current ? dollars(current.rateCents) : "");
  const [minimum, setMinimum] = useState(current ? dollars(current.minimumChargeCents) : "0.00");
  const [tiers, setTiers] = useState<TierDraft[]>(current?.quantityTiers?.map((tier) => ({ minQuantity: String(tier.minQuantity), rate: dollars(tier.rateCents) })) ?? []);
  const [error, setError] = useState<string | null>(null);
  const sheetWidth = Number(tree.meta?.formulaVariables?.sheet_width) > 0 ? Number(tree.meta?.formulaVariables?.sheet_width) : 48;
  const sheetHeight = Number(tree.meta?.formulaVariables?.sheet_length) > 0 ? Number(tree.meta?.formulaVariables?.sheet_length) : 96;
  useEffect(() => {
    setUnit(current?.unit ?? "per_square_foot"); setRate(current ? dollars(current.rateCents) : "");
    setMinimum(current ? dollars(current.minimumChargeCents) : "0.00");
    setTiers(current?.quantityTiers?.map((tier) => ({ minQuantity: String(tier.minQuantity), rate: dollars(tier.rateCents) })) ?? []);
  }, [tree]);
  if (!/\b(?:coroplast|corrugated\s+plastic)\b/i.test(productName) && !current) return null;

  const apply = () => {
    const parsed = blankCoroplastPricingSchema.safeParse({ unit, rateCents: cents(rate), minimumChargeCents: cents(minimum),
      quantityTiers: tiers.map((tier) => ({ minQuantity: Number(tier.minQuantity), rateCents: cents(tier.rate) })) });
    if (!parsed.success) { setError("Enter a positive selling rate, a nonnegative minimum, and increasing quantity tiers starting at 1."); return; }
    try { onUpdate(withBlankCoroplastPricing(tree, parsed.data)); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Blank pricing could not be applied to this draft."); }
  };
  return <section className="rounded-lg border border-slate-600 bg-slate-800 p-4 text-slate-100" aria-label="Unprinted Coroplast pricing">
    <h3 className="font-semibold">Printed and Unprinted Coroplast</h3>
    <p className="mt-1 text-sm text-slate-300">Add an unprinted option to this Product. Printed pricing stays as configured. Cutting and finishing remain selectable. Save and publish the Product configuration after applying changes here.</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      <label className="text-sm">Unprinted unit<select className="mt-1 h-9 w-full rounded border border-slate-500 bg-slate-900 px-2" value={unit} onChange={(event) => setUnit(event.target.value as typeof unit)}><option value="per_square_foot">Per square foot</option><option value="per_piece">Per piece</option></select></label>
      <label className="text-sm">Selling rate ($)<Input className="mt-1" inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} /></label>
      <label className="text-sm">Minimum charge ($)<Input className="mt-1" inputMode="decimal" value={minimum} onChange={(event) => setMinimum(event.target.value)} /></label>
    </div>
    <div className="mt-3 text-sm">Quantity tiers <span className="text-slate-400">(optional, rate for the whole line)</span></div>
    {tiers.map((tier, index) => <div className="mt-2 flex flex-wrap items-center gap-2" key={index}>
      <label className="text-xs">From quantity<Input aria-label={`Tier ${index + 1} starting quantity`} className="mt-1 w-28" inputMode="numeric" value={tier.minQuantity} onChange={(event) => setTiers((old) => old.map((entry, i) => i === index ? { ...entry, minQuantity: event.target.value } : entry))} /></label>
      <label className="text-xs">Rate ($)<Input aria-label={`Tier ${index + 1} selling rate`} className="mt-1 w-28" inputMode="decimal" value={tier.rate} onChange={(event) => setTiers((old) => old.map((entry, i) => i === index ? { ...entry, rate: event.target.value } : entry))} /></label>
      <Button type="button" variant="outline" size="sm" onClick={() => setTiers((old) => old.filter((_, i) => i !== index))}>Remove tier {index + 1}</Button>
    </div>)}
    <div className="mt-3 flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setTiers((old) => [...old, { minQuantity: old.length ? "" : "1", rate: "" }])}>Add tier</Button><Button type="button" size="sm" onClick={apply}>Apply to Product draft</Button></div>
    {error ? <p role="alert" className="mt-2 text-sm text-red-300">{error}</p> : null}
    <p className="mt-3 text-xs text-slate-300">Flute example: a {sheetWidth} in wide × {sheetHeight} in high sheet has channels along {sheetHeight} in. Vertical is parallel to finished height; horizontal is parallel to finished width. Existing fit and rotation rules still apply.</p>
  </section>;
}
