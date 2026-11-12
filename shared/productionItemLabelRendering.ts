import { productionLabelDocumentSchema, type ProductionLabelDocument } from "./productionItemLabels";

function escapeLabelText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Shared by the staff preview, browser print fallback and claimed WebView2 document. */
export function renderProductionItemLabelsHtml(input: ProductionLabelDocument) {
  const { media, labels } = productionLabelDocumentSchema.parse(input);
  const { widthMm, heightMm } = media;
  const pages = labels.map(label => '<section class="production-item-label"><div class="label-content">' +
    label.rows.map(row => '<div>' + escapeLabelText(row) + '</div>').join("") + '</div></section>').join("");
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Production Item Labels</title>' +
    '<meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; style-src &apos;unsafe-inline&apos;; base-uri &apos;none&apos;; form-action &apos;none&apos;">' +
    '<style>@page{size:' + widthMm + 'mm ' + heightMm + 'mm;margin:0}' +
    'html,body{margin:0;padding:0;background:#fff;color:#000}' +
    '.production-item-label{box-sizing:border-box;width:' + widthMm + 'mm;height:' + heightMm + 'mm;padding:3mm;' +
    'overflow:hidden;break-inside:avoid;font:400 10pt/1.25 Arial,sans-serif;overflow-wrap:anywhere;white-space:pre-wrap}' +
    '.production-item-label:not(:last-child){break-after:page}' +
    '.production-item-label .label-content{height:100%}' +
    '.production-item-label .label-content>div+div{margin-top:1mm}</style></head><body>' + pages + '</body></html>';
}
