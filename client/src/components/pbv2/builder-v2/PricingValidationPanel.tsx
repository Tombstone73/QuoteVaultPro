import React from 'react';
import { DollarSign, AlertTriangle, CheckCircle, AlertCircleIcon, Info, Weight } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import type { Finding } from '@shared/pbv2/findings';

interface PricingValidationPanelProps {
  pricingPreview: {
    addOnCents: number;
    breakdown: Array<{ label: string; cents: number }>;
  } | null;
  weightPreview: {
    totalOz: number;
    breakdown: Array<{ label: string; oz: number }>;
  } | null;
  findings: Finding[];
  previewQuantity?: number;
}

export function PricingValidationPanel({
  pricingPreview,
  weightPreview,
  findings,
  previewQuantity = 500
}: PricingValidationPanelProps) {
  const errors = findings.filter(f => f.severity === 'ERROR');
  const warnings = findings.filter(f => f.severity === 'WARNING');
  const infos = findings.filter(f => f.severity === 'INFO');

  const total = pricingPreview ? pricingPreview.addOnCents / 100 : 0;

  const formatWeight = (oz: number) => {
    if (oz >= 16) {
      const lbs = oz / 16;
      return `${oz.toFixed(oz % 1 === 0 ? 0 : 2)} oz (${lbs.toFixed(2)} lb)`;
    }
    return `${oz.toFixed(oz % 1 === 0 ? 0 : 2)} oz`;
  };

  return (
    <aside className="h-full w-full bg-[#0f172a] border-l border-[#334155] flex flex-col overflow-hidden">
      <div className="border-b border-[#334155] p-4">
        <div className="flex items-center gap-2 mb-4">
          <DollarSign className="h-4 w-4 text-blue-400" />
          <h2 className="font-semibold text-slate-200">Pricing Preview</h2>
        </div>

        {pricingPreview ? (
          <div className="space-y-3">
            <div className="bg-[#1e293b] border border-[#334155] rounded-lg p-4">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-sm text-slate-400">Add-on Total</span>
                <div className="flex items-baseline gap-1">
                  <DollarSign className="h-4 w-4 text-slate-400" />
                  <span className="text-2xl font-semibold text-slate-100">
                    {total.toFixed(2)}
                  </span>
                </div>
              </div>
              <div className="text-xs text-slate-500">
                Based on current configuration (Qty: {previewQuantity})
              </div>
            </div>

            {pricingPreview.breakdown.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-semibold text-slate-400 mb-2">Breakdown</div>
                {pricingPreview.breakdown.map((item, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between text-sm py-1.5 px-2 rounded hover:bg-slate-800/50"
                  >
                    <span className="text-slate-400">
                      {item.label}
                    </span>
                    <span className="font-mono text-slate-200">
                      ${(item.cents / 100).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-slate-400 bg-slate-800/30 border border-slate-700/50 rounded p-3">
            Configure pricing components in options to see preview
          </div>
        )}
      </div>

      {weightPreview && (
        <div className="border-b border-[#334155] p-4">
          <div className="flex items-center gap-2 mb-4">
            <Weight className="h-4 w-4 text-purple-400" />
            <h2 className="font-semibold text-slate-200">Weight Preview</h2>
          </div>

          <div className="space-y-3">
            <div className="bg-[#1e293b] border border-[#334155] rounded-lg p-4">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-sm text-slate-400">Total Weight</span>
                <div className="flex items-baseline gap-1">
                  <Weight className="h-4 w-4 text-slate-400" />
                  <span className="text-2xl font-semibold text-slate-100">
                    {formatWeight(weightPreview.totalOz)}
                  </span>
                </div>
              </div>
              <div className="text-xs text-slate-500">
                Based on current configuration (Qty: {previewQuantity})
              </div>
            </div>

            {weightPreview.breakdown.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-semibold text-slate-400 mb-2">Breakdown</div>
                {weightPreview.breakdown
                  .filter(item => item.oz !== 0)
                  .map((item, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between text-sm py-1.5 px-2 rounded hover:bg-slate-800/50"
                    >
                      <span className="text-slate-400">
                        {item.label}
                      </span>
                      <span className="font-mono text-slate-200">
                        {item.oz.toFixed(item.oz % 1 === 0 ? 0 : 2)} oz
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <h3 className="font-semibold text-slate-200">Validation</h3>
            </div>

            {findings.length === 0 ? (
              <div className="flex items-start gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                <CheckCircle className="h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                <div className="text-emerald-300">
                  <div className="font-medium mb-1">All checks passed</div>
                  <div className="text-sm text-emerald-400/70">
                    No issues detected in the current configuration.
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {errors.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-red-200 mb-2 flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-red-500" />
                      {errors.length} Error{errors.length !== 1 ? 's' : ''}
                    </div>
                    {errors.map((finding, i) => (
                      <div
                        key={`err-${i}`}
                        className="p-3 bg-red-500/10 border-2 border-red-500 rounded-md"
                      >
                        <div className="flex items-start gap-2">
                          <AlertCircleIcon className="h-4 w-4 text-red-300 mt-0.5 flex-shrink-0" />
                          <div>
                            <div className="font-semibold text-red-200 mb-1">
                              {finding.code}
                            </div>
                            <div className="text-sm text-red-300">
                              {finding.message}
                            </div>
                            {finding.path && (
                              <div className="text-xs text-red-400/70 mt-1 font-mono">
                                {finding.path}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {warnings.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-amber-200 mb-2 flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-amber-500" />
                      {warnings.length} Warning{warnings.length !== 1 ? 's' : ''}
                    </div>
                    {warnings.map((finding, i) => (
                      <div
                        key={`warn-${i}`}
                        className="p-3 bg-amber-500/10 border-2 border-amber-500/40 rounded-md"
                      >
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 text-amber-300 mt-0.5 flex-shrink-0" />
                          <div>
                            <div className="font-semibold text-amber-200 mb-1">
                              {finding.code}
                            </div>
                            <div className="text-sm text-amber-300">
                              {finding.message}
                            </div>
                            {finding.path && (
                              <div className="text-xs text-amber-400/70 mt-1 font-mono">
                                {finding.path}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {infos.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-blue-200 mb-2 flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      {infos.length} Info
                    </div>
                    {infos.map((finding, i) => (
                      <div
                        key={`info-${i}`}
                        className="p-3 bg-blue-500/15 border border-blue-500/40 rounded-lg"
                      >
                        <div className="flex items-start gap-2">
                          <Info className="h-4 w-4 text-blue-300 mt-0.5 flex-shrink-0" />
                          <div>
                            <div className="font-semibold text-blue-200 mb-1">
                              {finding.code}
                            </div>
                            <div className="text-sm text-blue-300">
                              {finding.message}
                            </div>
                            {finding.path && (
                              <div className="text-xs text-blue-400/70 mt-1 font-mono">
                                {finding.path}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}
