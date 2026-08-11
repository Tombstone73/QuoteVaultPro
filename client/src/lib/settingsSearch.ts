import {
  Bell,
  Boxes,
  Brain,
  DollarSign,
  Factory,
  HardDrive,
  Hash,
  KeyRound,
  Mail,
  Package,
  Palette,
  PlugZap,
  Printer,
  Settings,
  Sliders,
  Tag,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { hasOwnerOnlyAdminToolsRole } from "@shared/roleAccess";

export type SettingsSearchKind = "page" | "setting";

export type SettingsSearchEntry = {
  id: string;
  kind: SettingsSearchKind;
  label: string;
  category: string;
  section?: string;
  description: string;
  route: string;
  anchor?: string;
  keywords?: readonly string[];
  ownerOnly?: boolean;
  icon?: LucideIcon;
  searchPriority?: number;
};

export type SettingsSearchResult = SettingsSearchEntry & {
  score: number;
};

export type SettingsNavEntry = SettingsSearchEntry & {
  icon: LucideIcon;
};

export const SETTINGS_NAV_ITEMS: readonly SettingsNavEntry[] = [
  { id: "company", kind: "page", label: "Company", category: "Settings", description: "Company info and defaults", route: "/settings/company", icon: Settings },
  { id: "preferences", kind: "page", label: "Preferences", category: "Settings", description: "Workflow and behavior preferences", route: "/settings/preferences", icon: Sliders },
  { id: "customer-portal", kind: "page", label: "Customer Portal", category: "Settings", description: "Company portal access and contact invitations", route: "/settings/customer-portal", icon: KeyRound },
  { id: "users", kind: "page", label: "Users & Roles", category: "Settings", description: "User management and permissions", route: "/settings/users", icon: Users },
  { id: "products", kind: "page", label: "Product Catalog", category: "Settings", description: "Products and pricing", route: "/settings/products", icon: Package },
  { id: "product-types", kind: "page", label: "Product Types", category: "Settings", description: "Product categories and types", route: "/settings/product-types", icon: Tag },
  { id: "pricing-formulas", kind: "page", label: "Pricing Formulas", category: "Settings", description: "Pricing calculation rules", route: "/settings/pricing-formulas", icon: DollarSign },
  { id: "integrations", kind: "page", label: "Accounting & Integrations", category: "Settings", description: "QuickBooks and other integrations", route: "/settings/integrations", icon: PlugZap },
  { id: "email", kind: "page", label: "Email Settings", category: "Settings", description: "Email configuration for invoices and quotes", route: "/settings/email", icon: Mail },
  { id: "storage", kind: "page", label: "Storage", category: "Settings", description: "Canonical storage routing and provider status", route: "/settings/storage", icon: HardDrive },
  { id: "ai", kind: "page", label: "AI Settings", category: "Settings", description: "AI provider mode, BYOK, and feature availability", route: "/settings/ai", icon: Brain },
  { id: "production", kind: "page", label: "Production & Operations", category: "Settings", description: "Production workflow settings", route: "/settings/production", icon: Factory },
  { id: "printers", kind: "page", label: "Printers", category: "Settings", description: "Production ticket and document printer profiles", route: "/settings/printers", icon: Printer },
  { id: "inventory", kind: "page", label: "Inventory & Procurement", category: "Settings", description: "Inventory and vendor settings", route: "/settings/inventory", icon: Boxes },
  { id: "notifications", kind: "page", label: "Notifications", category: "Settings", description: "Email and notification preferences", route: "/settings/notifications", icon: Bell },
  { id: "appearance", kind: "page", label: "Appearance / Themes", category: "Settings", description: "UI theme and visual preferences", route: "/settings/appearance", icon: Palette, keywords: ["theme", "dark mode", "appearance"] },
  { id: "setup", kind: "page", label: "System Setup", category: "Settings", description: "System initialization and document numbering sequences", route: "/settings/setup", icon: Hash },
  { id: "admin-tools", kind: "page", label: "Admin Tools", category: "Settings", description: "Data portability and system administration", route: "/settings/admin-tools", icon: Wrench, ownerOnly: true },
];

export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  ...SETTINGS_NAV_ITEMS,
  {
    id: "company-info-branding",
    kind: "setting",
    label: "Company Info & Branding",
    category: "Company",
    section: "Company Settings",
    description: "Set company identity and branding used on invoices and generated documents.",
    route: "/settings/company",
    anchor: "company-info-branding",
    keywords: ["company logo", "logo", "branding", "company information"],
  },
  {
    id: "invoice-payment-details",
    kind: "setting",
    label: "Invoice & Payment Details",
    category: "Company",
    section: "Company Settings",
    description: "Configure invoice display, payment, and remittance details.",
    route: "/settings/company",
    anchor: "invoice-payment-details",
    keywords: ["invoice", "payment", "billing", "remittance"],
  },
  {
    id: "proofing-policy",
    kind: "setting",
    label: "Proofing Policy",
    category: "Production & Operations",
    section: "Production workflow",
    description: "Control whether product-level proof requirements are automatically enforced.",
    route: "/settings/production",
    anchor: "proofing-policy",
    keywords: ["proof", "proofs", "proofing", "customer proof", "approval", "proof required"],
    searchPriority: 0,
  },
  {
    id: "proof-approval",
    kind: "setting",
    label: "Proof Approval",
    category: "Production & Operations",
    section: "Production workflow",
    description: "Control whether required proof approval can be manually overridden during intake.",
    route: "/settings/production",
    anchor: "proof-approval",
    keywords: ["proof", "approval", "lock proof approval"],
    searchPriority: 1,
  },
  {
    id: "inbound-email-intake",
    kind: "setting",
    label: "Inbound Email Intake",
    category: "Email Settings",
    section: "Email",
    description: "Control email-based intake and connected inbound mailboxes.",
    route: "/settings/email",
    keywords: ["email", "inbox", "gmail", "mailbox", "inbound"],
  },
  {
    id: "email-templates",
    kind: "setting",
    label: "Email Templates",
    category: "Email Settings",
    section: "Email",
    description: "Configure default quote and invoice email subject lines and content.",
    route: "/settings/email",
    keywords: ["email", "invoice email", "quote email", "template"],
  },
  {
    id: "ai-provider",
    kind: "setting",
    label: "AI Provider",
    category: "AI Settings",
    section: "AI",
    description: "Choose the AI mode, provider, model, and optional organization key.",
    route: "/settings/ai",
    keywords: ["ai", "openai", "model", "byok", "api key"],
  },
  {
    id: "document-numbering",
    kind: "setting",
    label: "Document Numbering",
    category: "System Setup",
    section: "Numbering",
    description: "Set prefixes and next numbers for quotes, invoices, orders, and purchase orders.",
    route: "/settings/setup",
    keywords: ["invoice number", "quote number", "order number", "purchase order number", "prefix"],
  },
];

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function fieldScore(value: string | undefined, query: string, exactScore: number, prefixScore: number, containsScore: number): number | null {
  const normalized = normalize(value ?? "");
  if (!normalized) return null;
  if (normalized === query) return exactScore;
  if (normalized.startsWith(query)) return prefixScore;
  return normalized.includes(query) ? containsScore : null;
}

function entryScore(entry: SettingsSearchEntry, query: string): number | null {
  const scores = [
    fieldScore(entry.label, query, 0, 1, 2),
    fieldScore(entry.section, query, 3, 3, 3),
    fieldScore(entry.category, query, 4, 4, 4),
    ...((entry.keywords ?? []).map((keyword) => fieldScore(keyword, query, 5, 5, 5))),
    fieldScore(entry.description, query, 6, 6, 6),
  ].filter((score): score is number => score !== null);

  return scores.length ? Math.min(...scores) : null;
}

export function canAccessSettingsEntry(entry: SettingsSearchEntry, activeOrgRole?: string): boolean {
  return !entry.ownerOnly || hasOwnerOnlyAdminToolsRole(activeOrgRole);
}

export function searchSettings(query: string, activeOrgRole?: string): SettingsSearchResult[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];

  const matches: Array<SettingsSearchResult & { index: number }> = [];
  SETTINGS_SEARCH_ENTRIES.forEach((entry, index) => {
    if (!canAccessSettingsEntry(entry, activeOrgRole)) return;
    const score = entryScore(entry, normalizedQuery);
    if (score !== null) matches.push({ ...entry, score, index });
  });

  return matches
    .sort((left, right) => left.score - right.score || (left.searchPriority ?? 100) - (right.searchPriority ?? 100) || left.index - right.index)
    .map(({ index: _index, ...entry }) => entry);
}

export function nextSettingsSearchIndex(current: number, resultCount: number, direction: 1 | -1): number {
  if (!resultCount) return 0;
  return (current + direction + resultCount) % resultCount;
}

export function settingsSearchDestination(entry: Pick<SettingsSearchEntry, "route" | "anchor">): string {
  return entry.anchor ? `${entry.route}#${entry.anchor}` : entry.route;
}

export function focusSettingsTarget(anchor: string): boolean {
  const target = document.getElementById(anchor);
  if (!target) return false;

  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.focus({ preventScroll: true });
  target.classList.add("ring-2", "ring-titan-accent", "ring-offset-2");
  window.setTimeout(() => target.classList.remove("ring-2", "ring-titan-accent", "ring-offset-2"), 1800);
  return true;
}
