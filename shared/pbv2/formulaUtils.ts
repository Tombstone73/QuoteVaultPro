type FormulaSource = {
  name: string;
  code: string | null;
  description: string | null;
  pricingProfileKey: string;
  expression: string | null;
  config: Record<string, unknown> | null;
};

type DuplicateFormulaInput = {
  name: string;
  code: string;
  description?: string | null;
  pricingProfileKey?: string;
  expression?: string | null;
  config?: Record<string, unknown> | null;
  isActive: boolean;
};

export function buildDuplicateFormulaInput(source: FormulaSource): DuplicateFormulaInput {
  return {
    name: `${source.name} Copy`,
    code: source.code ? `${source.code}_COPY` : "COPY",
    description: source.description ?? "",
    pricingProfileKey: source.pricingProfileKey,
    expression: source.expression ?? "",
    config: source.config ? JSON.parse(JSON.stringify(source.config)) : null,
    isActive: false,
  };
}
