import { products, type Product } from "./data";

/**
 * Mock stand-in for the server configuration resolver.
 * Each Product exposes its own option definitions — configuration fields that
 * do not exist on a Product are dropped when the Product changes.
 */

export interface OptionDef {
  label: string;
  choices: string[];
  default: string;
}

export const productOptions: Record<string, OptionDef[]> = {
  p1: [
    { label: "Hem", choices: ["All sides", "Top & bottom", "None"], default: "All sides" },
    { label: "Grommets", choices: ["Every 24in", "Corners only", "None"], default: "Every 24in" },
    { label: "Sides", choices: ["Single", "Double"], default: "Single" },
  ],
  p2: [
    { label: "Sides", choices: ["Single", "Double"], default: "Single" },
    { label: "Flutes", choices: ["Vertical", "Horizontal"], default: "Vertical" },
  ],
  p3: [
    { label: "Laminate", choices: ["Gloss", "Matte", "None"], default: "Gloss" },
    { label: "Cut", choices: ["Contour", "Kiss cut"], default: "Contour" },
  ],
  p4: [
    { label: "Grommets", choices: ["2 (top)", "4 (corners)", "None"], default: "2 (top)" },
    { label: "Sides", choices: ["Single", "Double"], default: "Single" },
    { label: "Grade", choices: ["Engineer", "High Intensity"], default: "Engineer" },
  ],
  p5: [
    { label: "Mount", choices: ["Predrilled", "Cleat", "None"], default: "Predrilled" },
    { label: "Sides", choices: ["Single", "Double"], default: "Single" },
  ],
  p6: [
    { label: "Cut", choices: ["Kiss cut", "Full cut"], default: "Kiss cut" },
    { label: "Facing", choices: ["First surface", "Second surface"], default: "First surface" },
  ],
  p7: [
    { label: "Placement", choices: ["Front center", "Left chest", "Full back"], default: "Front center" },
    { label: "Garment", choices: ["Customer supplied", "Shop supplied"], default: "Customer supplied" },
  ],
  p8: [],
};

/** Dimension-based products price on area — quantity-only products do not. */
export const requiresDimensions = (p: Product | undefined) => p?.basis === "sq ft";

export const optionDefsFor = (productId: string): OptionDef[] => productOptions[productId] ?? [];

export const productById = (id: string) => products.find((p) => p.id === id);

/** Parse '24" × 18"' or '3ft × 8ft' into editable parts. */
export function parseSize(size: string | undefined): { w: string; h: string; unit: "in" | "ft" } {
  if (!size) return { w: "", h: "", unit: "in" };
  const unit: "in" | "ft" = size.includes("ft") ? "ft" : "in";
  const nums = size.match(/[\d.]+/g) ?? [];
  return { w: nums[0] ?? "", h: nums[1] ?? "", unit };
}

export function formatSize(w: string, h: string, unit: "in" | "ft") {
  if (!w || !h) return "";
  return unit === "ft" ? `${w}ft × ${h}ft` : `${w}" × ${h}"`;
}

/* ------------------------------------------------------------------
 * Mock stand-in for the server usage / material resolver.
 * Only products that actually have a substrate model produce usage rows.
 * ------------------------------------------------------------------ */

export interface UsageRow { label: string; value: string }
export interface MaterialNeed { material: string; need: string; available?: string | undefined }

/** Sheet-fed substrates: nested out of a parent sheet. */
const sheetStock: Record<string, { name: string; w: number; h: number }> = {
  p2: { name: "4mm Coroplast 48x96", w: 48, h: 96 },
  p4: { name: "4mm Coroplast 48x96", w: 48, h: 96 },
  p5: { name: "3mm ACM 48x96", w: 48, h: 96 },
};

/** Roll media: printed off a continuous roll of a given face width (in). */
const rollStock: Record<string, { name: string; width: number }> = {
  p1: { name: "13oz Scrim Banner", width: 63 },
  p6: { name: "Translucent Vinyl 54in", width: 54 },
  p3: { name: "Cast Vinyl 54in", width: 54 },
};

const round = (n: number, d = 1) => Number(n.toFixed(d));

/** Width/height in inches, whatever unit the size string used. */
function inches(size: { w: string; h: string; unit: "in" | "ft" }) {
  const f = size.unit === "ft" ? 12 : 1;
  return { w: (Number(size.w) || 0) * f, h: (Number(size.h) || 0) * f };
}

export interface UsageResult {
  sqft: number;
  rows: UsageRow[];
  sheets?: number | undefined;
  perSheet?: number | undefined;
  linearFt?: number | undefined;
}

export function computeUsage(
  productId: string,
  size: { w: string; h: string; unit: "in" | "ft" },
  qty: number,
): UsageResult | null {
  const product = productById(productId);
  if (!product || !requiresDimensions(product)) {
    // Quantity-only products: no fabricated area or sheet math.
    const roll = rollStock[productId];
    if (!roll) return null;
    return null;
  }
  const { w, h } = inches(size);
  if (!w || !h || !qty) return null;

  const sqft = round((w * h * qty) / 144, 1);
  const rows: UsageRow[] = [{ label: "Total square footage", value: `${sqft.toFixed(1)} sq ft` }];

  const sheet = sheetStock[productId];
  if (sheet) {
    const fit = (pw: number, ph: number) => Math.floor(sheet.w / pw) * Math.floor(sheet.h / ph);
    const perSheet = Math.max(fit(w, h), fit(h, w));
    if (perSheet > 0) {
      const sheets = Math.ceil(qty / perSheet);
      rows.push({ label: "Sheets required", value: `${sheets} sheets` });
      rows.push({ label: "Pieces per sheet", value: `${perSheet}` });
      return { sqft, rows, sheets, perSheet };
    }
    return { sqft, rows };
  }

  const roll = rollStock[productId];
  if (roll) {
    const across = Math.max(1, Math.floor(roll.width / w));
    const linearFt = round((Math.ceil(qty / across) * h) / 12, 1);
    rows.push({ label: "Linear footage", value: `${linearFt.toFixed(1)} lin ft` });
    rows.push({ label: "Pieces across roll", value: `${across}` });
    return { sqft, rows, linearFt };
  }

  return { sqft, rows };
}

/** Grommet counts implied by the selected configuration. */
function grommetCount(options: { label: string; value: string }[], size: { w: string; h: string; unit: "in" | "ft" }, qty: number) {
  const v = options.find((o) => o.label === "Grommets")?.value;
  if (!v || v === "None") return 0;
  if (v === "Corners only" || v === "4 (corners)") return 4 * qty;
  if (v === "2 (top)") return 2 * qty;
  if (v === "Every 24in") {
    const { w, h } = inches(size);
    return Math.max(4, Math.ceil((2 * (w + h)) / 24)) * qty;
  }
  return 0;
}

export function computeMaterials(
  productId: string,
  size: { w: string; h: string; unit: "in" | "ft" },
  qty: number,
  options: { label: string; value: string }[],
  stock: { name: string; onHand: number; reserved: number; unit: string }[],
): MaterialNeed[] {
  const product = productById(productId);
  if (!product) return [];
  const usage = computeUsage(productId, size, qty);
  const avail = (name: string) => {
    const m = stock.find((s) => s.name === name);
    if (!m) return undefined;
    const free = m.onHand - m.reserved;
    return `${free.toLocaleString()} ${m.unit}${free === 1 ? "" : "s"} available`;
  };
  const wastePct = (w: string) => (Number(w.replace("%", "")) || 0) / 100;

  const out: MaterialNeed[] = [];
  for (const r of product.recipe) {
    if (r.rule === "area") {
      if (!usage) continue;
      if (usage.sheets && r.material.includes("48x96")) {
        const sheets = Math.ceil(usage.sheets * (1 + wastePct(r.waste)));
        out.push({ material: r.material, need: `${sheets} sheets required`, available: avail(r.material) });
      } else {
        const sf = round(usage.sqft * (1 + wastePct(r.waste)), 0);
        out.push({ material: r.material, need: `${sf.toLocaleString()} sq ft required`, available: avail(r.material) });
      }
    } else if (r.rule === "perimeter") {
      if (!usage) continue;
      const { w, h } = inches(size);
      const ft = round((2 * (w + h) * qty) / 12, 0);
      out.push({ material: r.material, need: `${ft.toLocaleString()} lin ft required` });
    } else if (r.rule.startsWith("selected.") || r.rule === "2 each") {
      const count = r.rule === "2 each" ? 2 * qty : grommetCount(options, size, qty);
      if (count > 0) out.push({ material: r.material, need: `${count.toLocaleString()} pcs required`, available: avail(r.material) });
    } else if (r.rule === "1 each") {
      out.push({ material: r.material, need: `${qty.toLocaleString()} pcs required`, available: avail(r.material) });
    }
    // "coverage" rules (ink) carry no countable requirement in this prototype.
  }
  return out;
}
