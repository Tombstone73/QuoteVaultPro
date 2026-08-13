import type { AssistantContextEnvelope, AssistantStructuredCard } from "@shared/assistantContracts";
import { SYSTEM_GUIDE_MANIFEST_VERSION, systemGuideCapabilities, systemGuideRouteFor } from "@shared/systemGuideManifest";

export type SystemGuideAnswer = { response: string; cards: AssistantStructuredCard[]; title: string };

type GuideArticle = { title: string; route: string; body: string; prompts: string[]; terms: RegExp };

const articles: GuideArticle[] = [
  { title: "Order workflow", route: "/orders", terms: /\b(order entry|new order|order .*printing|order .*production|how .*order .*print)/i,
    body: "A new order starts with a customer and one or more priced line items. Each line keeps its own artwork, proof, routing, and production requirements. Routing determines whether a line needs design or Prepress before it is Print Ready. When the required artwork/proof/prepress gates are complete, staff schedule the line to its configured production station. Completing the production work moves it toward fulfillment; fulfillment and invoicing remain separate checks.", prompts: ["Explain Prepress routing", "What does Print Ready mean?", "Explain fulfillment"] },
  { title: "Quote lifecycle", route: "/quotes", terms: /\b(create|make|send|convert).*\bquote\b|\bquote.*\b(order|lifecycle)\b/i,
    body: "Create a quote with a customer, line items, quantities, options, pricing, tax, and any supporting artwork. Save or send the quote through its normal lifecycle. When it is accepted, use the quote-to-order flow so the approved line-item details, including supported parent/child relationships, carry into the order. Editing a quote does not itself create production work.", prompts: ["Explain quote-to-order conversion", "Open Quotes", "Explain child line items"] },
  { title: "Artwork, proofs, and Prepress", route: "/prepress", terms: /\b(prepress|proof|artwork|print ready)\b/i,
    body: "Artwork requirements are evaluated per line item. A proof-required line can wait for proof approval; a Prepress-required line waits until its prepress work is complete. Print Ready means the workflow has cleared the required gates and can be scheduled to production. The exact gates depend on the line's saved routing snapshot and organization/product defaults.", prompts: ["What does Print Ready mean?", "Explain production routing", "Open Prepress"] },
  { title: "Production routing", route: "/production", terms: /\b(flatbed|routing|station|production job|production line)\b/i,
    body: "An order line is the commercial and workflow record for one item sold on an order. A production job is the operational work created for that line at a station or managed step. Product routing and saved line-item routing determine the station, such as Flatbed, after the required workflow gates are cleared. A line can have production history without that history being deleted when it is bypassed.", prompts: ["Why did this line route to Flatbed?", "What is the difference between an order line and a production job?", "Open Production Board"] },
  { title: "Fulfillment and invoicing", route: "/fulfillment", terms: /\b(fulfillment|invoice|invoic|payment|billing)\b/i,
    body: "After required production work is complete, fulfillment prepares the work for pickup, delivery, or shipment. Billing readiness is evaluated from the current order and line-item policy; it is not assumed just because a production job exists. If an order is blocked, the order summary can show the reliable blocker when that data is available. Payment collection happens against invoices and does not change settlement logic through the System Guide.", prompts: ["Explain billing blockers", "Open Fulfillment", "Open Invoices"] },
  { title: "Products and PBV2", route: "/products", terms: /\b(pbv2|product routing|product .*pricing|materials?)\b/i,
    body: "PBV2 is PrintersHero's versioned product option and pricing configuration. It helps evaluate selected options and preserve a pricing snapshot for a line item. Product defaults can influence routing, dimensions, materials, proof, and Prepress requirements, but a saved line item retains its own snapshot. Materials are operational inputs; product sell units are the customer-facing item being sold.", prompts: ["Explain product routing", "What are materials versus product sell units?", "Open Products"] },
  { title: "Child line items", route: "/quotes", terms: /\b(child|add-on|add on|parent line)\b/i,
    body: "A child line item is an existing or newly created line linked under another eligible line in the same quote or order. It remains a real line item with its own files and production requirements. You can add a child, link an existing standalone item, change its parent, or unlink it. The relationship is preserved by quote-to-order conversion and child production can be bypassed independently when allowed.", prompts: ["How do I add a child item?", "Explain production bypass", "Open Quotes"] },
  { title: "Organization settings and permissions", route: "/settings", terms: /\b(permission|role|sales tax|setting|configure)\b/i,
    body: "Organization owners and admins configure organization-level settings, including settings pages such as AI configuration and applicable tax setup. Staff permissions are enforced by the backend for each action. The System Guide can explain a required role, but it never grants a permission or changes a setting. Use the relevant Settings page for configuration.", prompts: ["Where do I configure sales tax?", "What can the AI currently do?", "Open Settings"] },
];

function isActionRequest(message: string) {
  return /^(?:move|start|complete|send|create|update|delete|mark|invoice|fulfill)\b/i.test(message.trim())
    && !/^how\s+(?:do|can)\s+i\b/i.test(message.trim());
}

export function resolveSystemGuideAnswer(message: string, context: AssistantContextEnvelope): SystemGuideAnswer | null {
  if (isActionRequest(message)) return null;
  const screenQuestion = /\b(?:what does this page do|what should i do (?:here|next)|where do i go next|what does this button mean|why is this option disabled)\b/i.test(message);
  const article = articles.find((candidate) => candidate.terms.test(message));
  const route = systemGuideRouteFor(context.route);
  if (!article && !screenQuestion && !/\b(what can the ai (?:do|currently do)|how does printershero work)\b/i.test(message)) return null;
  const title = article?.title ?? route?.label ?? "PrintersHero System Guide";
  const routeLink = article?.route ?? route?.pattern ?? "/settings";
  const response = screenQuestion && route
    ? `${route.label} is for ${route.summary} Typical next steps depend on the current record and your role. ${article ? article.body : "Use the visible page controls to review the current work; the assistant does not infer hidden controls."}`
    : /what can the ai/i.test(message)
      ? "The assistant can explain workflows, screens, statuses, permissions, and supported record context. It can use approved read-only tools and registered confirmation-gated commands, including reviewed canonical Product administration. It cannot run external research, MCP, SQL, arbitrary backend operations, or any mutation not exposed by the canonical capability registry."
      : article?.body ?? "I can explain this screen from the current route, but there is not yet an approved guide article for the requested workflow.";
  const suggestions = (article?.prompts ?? ["What does this page do?", "Explain order workflow", "What can the AI currently do?"]).slice(0, 4)
    .map((prompt, index) => ({ id: `guide-${index}`, label: prompt, prompt, intent: "system_guide", presentationPriority: index + 1 }));
  return {
    title,
    response,
    cards: [{ kind: "partial_result", title, summary: `Based on PrintersHero ${title}.`, sourceLinks: [{ label: `View ${title}`, href: routeLink }], toolStatus: "succeeded", details: { suggestedPrompts: suggestions, sourceType: "system_manifest", manifestVersion: SYSTEM_GUIDE_MANIFEST_VERSION, freshness: "current build", capabilities: /what can the ai/i.test(message) ? systemGuideCapabilities : undefined } }],
  };
}
