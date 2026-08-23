import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  formulaApi,
  newBusinessRequestId,
  type FormulaDomainDeclaredInput,
  type FormulaDomainDefinition,
  type FormulaDomainListEntry,
} from "./api";

type EditorState = Readonly<{
  name: string;
  description: string;
  expression: string;
  visibility: "product_scoped" | "library";
  declaredInputs: readonly FormulaDomainDeclaredInput[];
}>;

const blankEditor = (): EditorState => ({
  name: "",
  description: "",
  expression: "",
  visibility: "library",
  declaredInputs: [],
});

const editorFrom = (formula: FormulaDomainListEntry): EditorState => ({
  name: formula.name,
  description: formula.description ?? "",
  expression: formula.revision.expression,
  visibility: formula.visibility,
  declaredInputs: formula.revision.declaredInputs,
});

const definitionOf = (state: EditorState): FormulaDomainDefinition => ({
  expression: state.expression.trim(),
  declaredInputs: state.declaredInputs.map((input) => ({
    ...input,
    key: input.key.trim(),
    label: input.label.trim(),
    description: input.description?.trim() || undefined,
  })),
});

const optionalNumber = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : undefined;
};

const formulaKey = (organizationId: string) =>
  ["v2", organizationId, "formulas"] as const;
const inputTypes = ["number", "integer", "boolean"] as const;

const errorText = (error: unknown) =>
  (error as { message?: string })?.message ??
  "The Formula service is unavailable.";

/** Formula-domain authoring surface. Formula expressions and revisions remain
 * owned by the canonical Formula API; this workspace stores no local formulas. */
export const FormulaLibraryWorkspace = ({
  organizationId,
  sessionScope,
  canEdit,
}: Readonly<{
  organizationId: string;
  sessionScope: string;
  canEdit: boolean;
}>) => {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [mode, setMode] = useState<"view" | "create" | "revise">("view");
  const [editor, setEditor] = useState<EditorState>(blankEditor);
  const formulas = useQuery({
    queryKey: [
      ...formulaKey(organizationId),
      query,
      includeInactive,
      sessionScope,
    ],
    queryFn: () => formulaApi.list(organizationId, { query, includeInactive }),
    enabled: Boolean(organizationId && sessionScope),
  });
  const selected = useMemo(
    () =>
      formulas.data?.find((formula) => formula.formulaId === selectedId) ??
      formulas.data?.[0],
    [formulas.data, selectedId],
  );
  const revisions = useQuery({
    queryKey: [
      ...formulaKey(organizationId),
      selected?.formulaId ?? "",
      "revisions",
      sessionScope,
    ],
    queryFn: () => formulaApi.revisions(organizationId, selected!.formulaId),
    enabled: Boolean(organizationId && sessionScope && selected?.formulaId),
  });
  const usage = useQuery({
    queryKey: [
      ...formulaKey(organizationId),
      selected?.formulaId ?? "",
      "usage",
      sessionScope,
    ],
    queryFn: () => formulaApi.usage(organizationId, selected!.formulaId),
    enabled: Boolean(organizationId && sessionScope && selected?.formulaId),
  });
  useEffect(() => {
    if (selected && mode === "view") setEditor(editorFrom(selected));
  }, [selected, mode]);

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: formulaKey(organizationId),
    });
  };
  const create = useMutation({
    mutationFn: () =>
      formulaApi.create(organizationId, newBusinessRequestId(), {
        name: editor.name.trim(),
        ...(editor.description.trim()
          ? { description: editor.description.trim() }
          : {}),
        visibility: editor.visibility,
        definition: definitionOf(editor),
      }),
    onSuccess: async (formula) => {
      setSelectedId(formula.formulaId);
      setMode("view");
      await refresh();
    },
  });
  const revise = useMutation({
    mutationFn: () =>
      formulaApi.revise(
        organizationId,
        selected!.formulaId,
        newBusinessRequestId(),
        {
          expectedCurrentRevisionId: selected!.currentRevisionId,
          definition: definitionOf(editor),
        },
      ),
    onSuccess: async () => {
      setMode("view");
      await refresh();
    },
  });
  const visibility = useMutation({
    mutationFn: (next: "product_scoped" | "library") =>
      formulaApi.setVisibility(
        organizationId,
        selected!.formulaId,
        newBusinessRequestId(),
        {
          expectedCurrentRevisionId: selected!.currentRevisionId,
          visibility: next,
        },
      ),
    onSuccess: refresh,
  });
  const status = useMutation({
    mutationFn: (next: "active" | "inactive") =>
      formulaApi.setStatus(
        organizationId,
        selected!.formulaId,
        newBusinessRequestId(),
        {
          expectedCurrentRevisionId: selected!.currentRevisionId,
          status: next,
        },
      ),
    onSuccess: refresh,
  });
  const busy =
    create.isPending ||
    revise.isPending ||
    visibility.isPending ||
    status.isPending;
  const mutationError =
    create.error ?? revise.error ?? visibility.error ?? status.error;
  const patchInput = (
    index: number,
    patch: Partial<FormulaDomainDeclaredInput>,
  ) =>
    setEditor((current) => ({
      ...current,
      declaredInputs: current.declaredInputs.map((input, inputIndex) =>
        inputIndex === index ? { ...input, ...patch } : input,
      ),
    }));

  return (
    <section className="lab v2-formula-library">
      <header className="v2-workspace-header">
        <div>
          <small>PRICING</small>
          <h1>Formula Library</h1>
          <p>
            Create immutable Formula revisions and see where each revision is
            used.
          </p>
        </div>
        <button
          className="button"
          type="button"
          disabled={!canEdit || busy}
          onClick={() => {
            setEditor(blankEditor());
            setMode("create");
          }}
        >
          New Formula
        </button>
      </header>
      {mutationError && (
        <div className="notice error">{errorText(mutationError)}</div>
      )}
      <div className="v2-formula-library-layout">
        <section className="card v2-formula-list" aria-label="Formula library">
          <header>
            <label className="field">
              Search formulas
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search formulas"
              />
            </label>
            <label className="v2-formula-filter">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(event) => setIncludeInactive(event.target.checked)}
              />{" "}
              Show inactive
            </label>
          </header>
          {formulas.isLoading ? (
            <p>Loading formulas…</p>
          ) : formulas.error ? (
            <div className="notice error">{errorText(formulas.error)}</div>
          ) : formulas.data?.length ? (
            <div className="v2-formula-list-items">
              {formulas.data.map((formula) => (
                <button
                  type="button"
                  key={formula.formulaId}
                  className={
                    selected?.formulaId === formula.formulaId
                      ? "is-selected"
                      : ""
                  }
                  onClick={() => {
                    setSelectedId(formula.formulaId);
                    setMode("view");
                  }}
                >
                  <span>
                    <b>{formula.name}</b>
                    <small>
                      Revision {formula.revision.revisionNumber} ·{" "}
                      {formula.visibility === "library"
                        ? "My Formula Library"
                        : "Product-scoped"}
                    </small>
                  </span>
                  <em className={`v2-formula-status ${formula.status}`}>
                    {formula.status}
                  </em>
                </button>
              ))}
            </div>
          ) : (
            <p>No Formula Library entries match this view.</p>
          )}
        </section>
        <section className="card v2-formula-detail">
          {!selected && mode !== "create" ? (
            <p>Select a Formula to inspect its revision and usage.</p>
          ) : (
            <>
              {mode === "view" && selected ? (
                <FormulaDetail
                  formula={selected}
                  revisions={revisions.data ?? []}
                  usage={usage.data ?? []}
                  loading={revisions.isLoading || usage.isLoading}
                  canEdit={canEdit}
                  busy={busy}
                  onEdit={() => {
                    setEditor(editorFrom(selected));
                    setMode("revise");
                  }}
                  onVisibility={() =>
                    visibility.mutate(
                      selected.visibility === "library"
                        ? "product_scoped"
                        : "library",
                    )
                  }
                  onStatus={() =>
                    status.mutate(
                      selected.status === "active" ? "inactive" : "active",
                    )
                  }
                />
              ) : (
                <FormulaEditor
                  organizationId={organizationId}
                  title={
                    mode === "create"
                      ? "New Formula"
                      : `Edit ${selected?.name ?? "Formula"}`
                  }
                  revisionMode={mode === "revise"}
                  state={editor}
                  busy={busy}
                  submitLabel={
                    mode === "create" ? "Create Formula" : "Create new revision"
                  }
                  onChange={setEditor}
                  onPatchInput={patchInput}
                  onRemoveInput={(index) =>
                    setEditor((current) => ({
                      ...current,
                      declaredInputs: current.declaredInputs.filter(
                        (_, inputIndex) => inputIndex !== index,
                      ),
                    }))
                  }
                  onAddInput={() =>
                    setEditor((current) => ({
                      ...current,
                      declaredInputs: [
                        ...current.declaredInputs,
                        {
                          key: "",
                          label: "",
                          type: "number",
                          required: false,
                          authorable: true,
                        },
                      ],
                    }))
                  }
                  onCancel={() => {
                    setMode("view");
                    if (selected) setEditor(editorFrom(selected));
                  }}
                  onSubmit={() =>
                    mode === "create" ? create.mutate() : revise.mutate()
                  }
                />
              )}
            </>
          )}
        </section>
      </div>
    </section>
  );
};

const FormulaDetail = ({
  formula,
  revisions,
  usage,
  loading,
  canEdit,
  busy,
  onEdit,
  onVisibility,
  onStatus,
}: Readonly<{
  formula: FormulaDomainListEntry;
  revisions: readonly FormulaDomainListEntry["revision"][];
  usage: readonly Readonly<{
    productId: string;
    productVersionId: string;
    formulaRevisionId: string;
    revisionNumber: number;
    productName: string;
    versionStatus: string;
  }>[];
  loading: boolean;
  canEdit: boolean;
  busy: boolean;
  onEdit: () => void;
  onVisibility: () => void;
  onStatus: () => void;
}>) => (
  <>
    <header className="v2-formula-detail-header">
      <div>
        <small>FORMULA</small>
        <h2>{formula.name}</h2>
        <p>{formula.description || "No description"}</p>
      </div>
      <div className="v2-formula-actions">
        <button
          className="button secondary"
          type="button"
          disabled={!canEdit || busy}
          onClick={onEdit}
        >
          Edit Formula
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={!canEdit || busy}
          onClick={onVisibility}
        >
          {formula.visibility === "library"
            ? "Make Product-scoped"
            : "Add to Library"}
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={!canEdit || busy}
          onClick={onStatus}
        >
          {formula.status === "active" ? "Deactivate" : "Activate"}
        </button>
      </div>
    </header>
    <dl className="v2-formula-facts">
      <div>
        <dt>Current revision</dt>
        <dd>Revision {formula.revision.revisionNumber}</dd>
      </div>
      <div>
        <dt>Visibility</dt>
        <dd>
          {formula.visibility === "library"
            ? "My Formula Library"
            : "Product-scoped / unlisted"}
        </dd>
      </div>
      <div>
        <dt>Usage</dt>
        <dd>
          {formula.usageCount ?? usage.length} ProductVersion
          {(formula.usageCount ?? usage.length) === 1 ? "" : "s"}
        </dd>
      </div>
    </dl>
    <section className="v2-formula-section">
      <h3>Formula expression</h3>
      <pre>{formula.revision.expression}</pre>
      <p>
        Formula expressions are read-only here. Editing creates a new revision;
        Products using older revisions remain unchanged.
      </p>
    </section>
    <section className="v2-formula-section">
      <h3>Declared inputs</h3>
      {formula.revision.declaredInputs.length ? (
        <table>
          <thead>
            <tr>
              <th>Input</th>
              <th>Type</th>
              <th>Required</th>
              <th>Range / unit</th>
            </tr>
          </thead>
          <tbody>
            {formula.revision.declaredInputs.map((input) => (
              <tr key={input.key}>
                <td>
                  <b>{input.label}</b>
                  <small>
                    {input.key}
                    {input.description ? ` · ${input.description}` : ""}
                  </small>
                </td>
                <td>{input.type}</td>
                <td>{input.required ? "Required" : "Optional"}</td>
                <td>
                  {input.minimum ?? "—"} to {input.maximum ?? "—"}
                  {input.unit ? ` ${input.unit}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No Product-specific inputs are declared.</p>
      )}
    </section>
    <FormulaTester
      organizationId={formula.revision.organizationId}
      definition={{
        expression: formula.revision.expression,
        declaredInputs: formula.revision.declaredInputs,
      }}
    />
    <section className="v2-formula-section">
      <h3>Revision history</h3>
      {loading ? (
        <p>Loading revision history…</p>
      ) : (
        <ol className="v2-formula-revisions">
          {revisions.map((revision) => (
            <li key={revision.formulaRevisionId}>
              <b>Revision {revision.revisionNumber}</b>
              <span>{new Date(revision.createdAt).toLocaleString()}</span>
              <code>{revision.expression}</code>
            </li>
          ))}
        </ol>
      )}
    </section>
    <section className="v2-formula-section">
      <h3>Formula usage</h3>
      {loading ? (
        <p>Loading Formula usage…</p>
      ) : usage.length ? (
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Lifecycle</th>
              <th>Revision</th>
            </tr>
          </thead>
          <tbody>
            {usage.map((row) => (
              <tr key={row.productVersionId}>
                <td>{row.productName}</td>
                <td>{row.versionStatus}</td>
                <td>Revision {row.revisionNumber}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>This Formula is not yet bound to a ProductVersion.</p>
      )}
    </section>
  </>
);

const FormulaEditor = ({
  organizationId,
  title,
  revisionMode,
  state,
  busy,
  submitLabel,
  onChange,
  onPatchInput,
  onRemoveInput,
  onAddInput,
  onCancel,
  onSubmit,
}: Readonly<{
  organizationId: string;
  title: string;
  revisionMode: boolean;
  state: EditorState;
  busy: boolean;
  submitLabel: string;
  onChange: (next: EditorState) => void;
  onPatchInput: (
    index: number,
    patch: Partial<FormulaDomainDeclaredInput>,
  ) => void;
  onRemoveInput: (index: number) => void;
  onAddInput: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}>) => (
  <>
    <header className="v2-formula-detail-header">
      <div>
        <small>FORMULA LIBRARY</small>
        <h2>{title}</h2>
        <p>
          {revisionMode
            ? "Name, description, and visibility are unchanged here. Saving creates an immutable Formula revision."
            : "Saving creates a Formula identity and immutable Revision 1."}
        </p>
      </div>
    </header>
    <div className="v2-formula-editor-fields">
      <label className="field">
        Name
        <input
          value={state.name}
          disabled={revisionMode}
          onChange={(event) => onChange({ ...state, name: event.target.value })}
        />
      </label>
      <label className="field">
        Visibility
        <select
          value={state.visibility}
          disabled={revisionMode}
          onChange={(event) =>
            onChange({
              ...state,
              visibility: event.target.value as EditorState["visibility"],
            })
          }
        >
          <option value="library">My Formula Library</option>
          <option value="product_scoped">Product-scoped / unlisted</option>
        </select>
      </label>
      <label className="field v2-formula-wide">
        Description
        <textarea
          value={state.description}
          disabled={revisionMode}
          onChange={(event) =>
            onChange({ ...state, description: event.target.value })
          }
        />
      </label>
      <label className="field v2-formula-wide">
        Expression
        <textarea
          className="v2-formula-expression-input"
          value={state.expression}
          onChange={(event) =>
            onChange({ ...state, expression: event.target.value })
          }
          placeholder="ceil((w * h * q) / 144) * p"
        />
      </label>
    </div>
    <section className="v2-formula-section">
      <header>
        <div>
          <h3>Declared inputs</h3>
          <p>Only declared inputs can receive Product-specific values.</p>
        </div>
        <button className="button secondary" type="button" onClick={onAddInput}>
          Add input
        </button>
      </header>
      {state.declaredInputs.map((input, index) => (
        <div className="v2-formula-input-card" key={`${input.key}:${index}`}>
          <div className="v2-formula-input-row">
            <input
              aria-label={`Input ${index + 1} key`}
              value={input.key}
              onChange={(event) =>
                onPatchInput(index, { key: event.target.value })
              }
              placeholder="key"
            />
            <input
              aria-label={`Input ${index + 1} label`}
              value={input.label}
              onChange={(event) =>
                onPatchInput(index, { label: event.target.value })
              }
              placeholder="Display label"
            />
            <select
              aria-label={`Input ${index + 1} type`}
              value={input.type}
              onChange={(event) =>
                onPatchInput(index, {
                  type: event.target
                    .value as FormulaDomainDeclaredInput["type"],
                })
              }
            >
              {inputTypes.map((type) => (
                <option value={type} key={type}>
                  {type}
                </option>
              ))}
            </select>
            <label>
              <input
                type="checkbox"
                checked={input.required}
                onChange={(event) =>
                  onPatchInput(index, { required: event.target.checked })
                }
              />{" "}
              Required
            </label>
            <label>
              <input
                type="checkbox"
                checked={input.authorable}
                onChange={(event) =>
                  onPatchInput(index, { authorable: event.target.checked })
                }
              />{" "}
              Authorable
            </label>
            <button
              className="button secondary"
              type="button"
              onClick={() => onRemoveInput(index)}
            >
              Remove
            </button>
          </div>
          <div className="v2-formula-input-meta">
            <input
              aria-label={`Input ${index + 1} description`}
              value={input.description ?? ""}
              onChange={(event) =>
                onPatchInput(index, {
                  description: event.target.value || undefined,
                })
              }
              placeholder="Description"
            />
            <input
              aria-label={`Input ${index + 1} minimum`}
              inputMode="decimal"
              value={input.minimum ?? ""}
              onChange={(event) =>
                onPatchInput(index, {
                  minimum: optionalNumber(event.target.value),
                })
              }
              placeholder="Minimum"
              disabled={input.type === "boolean"}
            />
            <input
              aria-label={`Input ${index + 1} maximum`}
              inputMode="decimal"
              value={input.maximum ?? ""}
              onChange={(event) =>
                onPatchInput(index, {
                  maximum: optionalNumber(event.target.value),
                })
              }
              placeholder="Maximum"
              disabled={input.type === "boolean"}
            />
            <select
              aria-label={`Input ${index + 1} unit`}
              value={input.unit ?? ""}
              onChange={(event) =>
                onPatchInput(index, {
                  unit: (event.target.value ||
                    undefined) as FormulaDomainDeclaredInput["unit"],
                })
              }
              disabled={input.type === "boolean"}
            >
              <option value="">No unit</option>
              <option value="in">in</option>
              <option value="sq_ft">sq ft</option>
            </select>
            {input.type === "boolean" ? (
              <select
                aria-label={`Input ${index + 1} default`}
                value={
                  input.defaultValue === undefined
                    ? ""
                    : String(input.defaultValue)
                }
                onChange={(event) =>
                  onPatchInput(index, {
                    defaultValue:
                      event.target.value === ""
                        ? undefined
                        : event.target.value === "true",
                  })
                }
              >
                <option value="">No default</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                aria-label={`Input ${index + 1} default`}
                inputMode="decimal"
                value={
                  typeof input.defaultValue === "number"
                    ? input.defaultValue
                    : ""
                }
                onChange={(event) =>
                  onPatchInput(index, {
                    defaultValue: optionalNumber(event.target.value),
                  })
                }
                placeholder="Default"
              />
            )}
          </div>
        </div>
      ))}
    </section>
    <FormulaTester
      organizationId={organizationId}
      definition={definitionOf(state)}
    />
    <footer className="v2-formula-editor-actions">
      <button
        className="button secondary"
        type="button"
        disabled={busy}
        onClick={onCancel}
      >
        Cancel
      </button>
      <button
        className="button"
        type="button"
        disabled={busy || !state.name.trim() || !state.expression.trim()}
        onClick={onSubmit}
      >
        {busy ? "Saving…" : submitLabel}
      </button>
    </footer>
  </>
);

const FormulaTester = ({
  organizationId,
  definition,
}: Readonly<{
  organizationId: string;
  definition: FormulaDomainDefinition;
}>) => {
  const definitionKey = JSON.stringify(definition);
  const stableDefinition = useMemo(
    () => JSON.parse(definitionKey) as FormulaDomainDefinition,
    [definitionKey],
  );
  const [width, setWidth] = useState("12");
  const [height, setHeight] = useState("12");
  const [quantity, setQuantity] = useState("1");
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const evaluate = useMutation({
    mutationFn: (input: Parameters<typeof formulaApi.evaluate>[1]) =>
      formulaApi.evaluate(organizationId, input),
  });
  const validInputs = useMemo(
    () =>
      stableDefinition.declaredInputs.every((input) => {
        const value = values[input.key];
        return !input.required || (value !== undefined && value !== "");
      }),
    [stableDefinition.declaredInputs, values],
  );
  useEffect(() => {
    const widthNumber = Number(width),
      heightNumber = Number(height),
      quantityNumber = Number(quantity);
    if (
      !organizationId ||
      !stableDefinition.expression.trim() ||
      !Number.isFinite(widthNumber) ||
      !Number.isFinite(heightNumber) ||
      !Number.isFinite(quantityNumber) ||
      !validInputs
    )
      return;
    const inputValues: Record<string, number | boolean> = {};
    for (const input of stableDefinition.declaredInputs) {
      const raw = values[input.key];
      if (raw === undefined || raw === "") {
        if (input.defaultValue !== undefined)
          inputValues[input.key] = input.defaultValue;
      } else if (input.type === "boolean")
        inputValues[input.key] = raw === true;
      else {
        const number = Number(raw);
        if (!Number.isFinite(number)) return;
        inputValues[input.key] = number;
      }
    }
    const timer = window.setTimeout(
      () =>
        evaluate.mutate({
          definition: stableDefinition,
          width: widthNumber,
          height: heightNumber,
          quantity: quantityNumber,
          inputValues,
        }),
      450,
    );
    return () => window.clearTimeout(timer);
  }, [
    organizationId,
    stableDefinition,
    width,
    height,
    quantity,
    values,
    validInputs,
  ]);
  return (
    <section className="v2-formula-section v2-formula-tester">
      <header>
        <div>
          <h3>Formula Tester</h3>
          <p>Tests this definition on the server. Nothing is saved.</p>
        </div>
        {evaluate.isPending && <span>Testing…</span>}
      </header>
      <div className="v2-formula-tester-inputs">
        <label className="field">
          Width
          <input
            inputMode="decimal"
            value={width}
            onChange={(event) => setWidth(event.target.value)}
          />
        </label>
        <label className="field">
          Height
          <input
            inputMode="decimal"
            value={height}
            onChange={(event) => setHeight(event.target.value)}
          />
        </label>
        <label className="field">
          Quantity
          <input
            inputMode="numeric"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
        {stableDefinition.declaredInputs.map((input) => (
          <label className="field" key={input.key}>
            {input.label}
            {input.type === "boolean" ? (
              <select
                value={
                  values[input.key] === undefined
                    ? ""
                    : String(values[input.key])
                }
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [input.key]:
                      event.target.value === ""
                        ? ""
                        : event.target.value === "true",
                  }))
                }
              >
                <option value="">
                  {input.defaultValue === undefined
                    ? "No value"
                    : `Default: ${String(input.defaultValue)}`}
                </option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                inputMode="decimal"
                value={
                  typeof values[input.key] === "string"
                    ? String(values[input.key])
                    : ""
                }
                placeholder={
                  input.defaultValue === undefined
                    ? input.required
                      ? "Required"
                      : "Optional"
                    : `Default: ${String(input.defaultValue)}`
                }
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [input.key]: event.target.value,
                  }))
                }
              />
            )}
          </label>
        ))}
      </div>
      {!validInputs && (
        <p className="v2-formula-tester-stale">
          Enter all required declared inputs to test.
        </p>
      )}
      {evaluate.error && (
        <div className="notice error">{errorText(evaluate.error)}</div>
      )}
      {evaluate.data && !evaluate.isPending && (
        <div className="v2-formula-test-result">
          <small>SERVER RESULT</small>
          <b>{evaluate.data.result}</b>
          <span>{evaluate.data.expression}</span>
        </div>
      )}
    </section>
  );
};
