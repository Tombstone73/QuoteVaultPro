import { useEffect } from "react";

type MarketingMetaProps = {
  title?: string;
  description?: string;
};

const DEFAULT_TITLE = "Printers Hero | Print Shop Workflow Software";
const DEFAULT_DESCRIPTION =
  "Print shop workflow software for quoting, orders, production, proofing, fulfillment, invoicing, and AI-assisted automation.";

function setMeta(nameOrProperty: "name" | "property", key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${nameOrProperty}="${key}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(nameOrProperty, key);
    document.head.appendChild(element);
  }
  element.content = content;
}

export function MarketingMeta({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
}: MarketingMetaProps) {
  useEffect(() => {
    document.title = title;
    setMeta("name", "description", description);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", description);
    setMeta("property", "og:type", "website");
    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("name", "twitter:title", title);
    setMeta("name", "twitter:description", description);
  }, [description, title]);

  return null;
}
