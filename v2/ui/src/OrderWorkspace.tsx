import React, { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  artworkApi,
  financeApi,
  fulfillmentApi,
  invoiceApi,
  money,
  newBusinessRequestId,
  orderApi,
  productionApi,
  proofingApi,
  quoteApi,
  type ApiError,
  type ArtworkOrderProjection,
  type OrderRead,
  type OrderResult,
  type ProductionWorkProjection,
  type ProofWorkProjection,
  type SalesLine,
} from "./api";
import { QuoteLineEditor } from "./QuoteLineEditor";
import {
  clearContactForCustomerChange,
  draftFromQuoteLine,
  emptyQuoteLineDraft,
  type QuoteLineMutationInput,
} from "./quoteFormModel";
import {
  salesKeys,
  useQuoteFormContacts,
  useQuoteFormCustomers,
  useQuoteFormProducts,
} from "./quoteFormQueries";
import { LifecycleBadge, SalesTotals } from "./SalesDocumentParts";
import {
  SalesDocumentEmpty,
  SalesDocumentFrame,
  SalesDocumentSplit,
} from "./SalesDocumentWorkspace";
import { orderConfigurationPresentation } from "./orderConfigurationPresentation";
import {
  OrderLineArtworkCompact,
  OrderLineArtworkDetail,
} from "./OrderLineArtwork";
import { orderRoutePresentation } from "./orderRoutingPresentation";

const message = (error: unknown): string => {
  const value = error as ApiError;
  if (value?.code === "STALE_STATE")
    return "This Order changed elsewhere. Reload and try again.";
  if (value?.code === "FORBIDDEN")
    return "You do not have permission for that Order action.";
  if (value?.code === "CONFLICT")
    return value.message || "That change is no longer available.";
  return value?.message ?? "The Order service is unavailable.";
};

const lineConfiguration = (line: SalesLine) =>
  orderConfigurationPresentation(line.resolvedConfiguration);

/** Only use this for typed domain states; customer-entered text is never transformed. */
const stateLabel = (value: string) =>
  value
    .replaceAll("_", " ")
    .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());

export const OrderWorkspace = (
  props: Readonly<{
    organizationId: string;
    sessionScope: string;
    orderId: string;
    canEdit: boolean;
    canCreate: boolean;
    canCancel: boolean;
    canOverridePrice: boolean;
    canViewInvoice: boolean;
    canViewArtwork: boolean;
    canViewProofing: boolean;
    canViewProduction: boolean;
    csrfReady: boolean;
    onBack: () => void;
    openOrder?: (orderId: string) => void;
    openCustomer?: (customerId: string) => void;
    openFulfillment?: (orderId: string) => void;
    openInvoice?: (invoiceId: string) => void;
    openArtwork?: (orderId: string, lineId: string) => void;
    openProofing?: (
      orderId: string,
      lineId: string,
      proofWorkId?: string,
    ) => void;
    openProduction?: (productionWorkId: string) => void;
    openRouting?: () => void;
    openQuote?: (quoteId: string) => void;
  }>,
) => {
  const queryClient = useQueryClient();
  const order = useQuery({
    queryKey: salesKeys.order(
      props.sessionScope,
      props.organizationId,
      props.orderId,
    ),
    queryFn: () => orderApi.get(props.organizationId, props.orderId),
    enabled: Boolean(
      props.organizationId && props.sessionScope && props.orderId,
    ),
  });
  const current = order.data;
  const [notice, setNotice] = useState("");
  const [editingLineId, setEditingLineId] = useState("");
  const [addVersion, setAddVersion] = useState(0);
  const [customerId, setCustomerId] = useState("");
  const [contactId, setContactId] = useState("");
  const [po, setPo] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [termsCode, setTermsCode] = useState("");
  const [notes, setNotes] = useState("");
  const [fulfillmentMethod, setFulfillmentMethod] = useState<
    "" | "pickup" | "shipping" | "local_delivery"
  >("");
  const [destination, setDestination] = useState({
    recipient: "",
    company: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    region: "",
    postalCode: "",
    country: "",
    phone: "",
  });
  const [fulfillmentInstructions, setFulfillmentInstructions] = useState("");
  const [adjustmentCents, setAdjustmentCents] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const requests = useRef<Record<string, { payload: string; id: string }>>({});
  const requestId = (operation: string, payload: unknown) => {
    const serialized = JSON.stringify(payload),
      prior = requests.current[operation];
    if (!prior || prior.payload !== serialized)
      requests.current[operation] = {
        payload: serialized,
        id: newBusinessRequestId(),
      };
    return requests.current[operation]!.id;
  };
  const complete = (operation: string) => {
    delete requests.current[operation];
  };
  const customers = useQuoteFormCustomers(
    props.sessionScope,
    props.organizationId,
  );
  const contacts = useQuoteFormContacts(
    props.sessionScope,
    props.organizationId,
    customerId,
  );
  const products = useQuoteFormProducts(
    props.sessionScope,
    props.organizationId,
  );
  const artwork = useQuery({
    queryKey: [
      "v2",
      props.sessionScope,
      props.organizationId,
      "artwork",
      "order",
      props.orderId,
    ],
    queryFn: () => artworkApi.forOrder(props.organizationId, props.orderId),
    enabled: Boolean(props.organizationId && props.sessionScope && current),
  });
  const fulfillment = useQuery({
    queryKey: [
      "v2",
      props.sessionScope,
      props.organizationId,
      "fulfillment",
      "order",
      props.orderId,
    ],
    queryFn: () => fulfillmentApi.get(props.organizationId, props.orderId),
    enabled: Boolean(props.organizationId && props.sessionScope && current),
  });
  const sourceQuote = useQuery({
    queryKey: [
      "v2",
      props.sessionScope,
      props.organizationId,
      "order-source-quote",
      current?.order.sourceQuoteId,
    ],
    queryFn: () =>
      quoteApi.get(props.organizationId, current!.order.sourceQuoteId!),
    enabled: Boolean(current?.order.sourceQuoteId),
  });
  const proofs = useQuery({
    queryKey: [
      "v2",
      props.sessionScope,
      props.organizationId,
      "order-proofs",
      props.orderId,
    ],
    queryFn: () => proofingApi.orderWorks(props.organizationId, props.orderId),
    enabled: Boolean(props.canViewProofing && current),
  });
  const production = useQuery({
    queryKey: [
      "v2",
      props.sessionScope,
      props.organizationId,
      "order-production",
      props.orderId,
    ],
    queryFn: () =>
      productionApi.orderWorks(props.organizationId, props.orderId),
    enabled: Boolean(props.canViewProduction && current),
  });
  const billing = useQuery({
    queryKey: [
      "v2",
      props.sessionScope,
      props.organizationId,
      "order-invoice",
      props.orderId,
    ],
    queryFn: () => invoiceApi.forOrder(props.organizationId, props.orderId),
    enabled: Boolean(props.canViewInvoice && current),
  });
  const settlement = useQuery({
    queryKey: [
      "v2",
      props.sessionScope,
      props.organizationId,
      "order-invoice-settlement",
      billing.data?.invoiceId,
    ],
    queryFn: () =>
      financeApi.invoice(props.organizationId, billing.data!.invoiceId),
    enabled: Boolean(props.canViewInvoice && billing.data?.invoiceId),
  });
  const history = useQuery({
    queryKey: [
      "v2",
      props.sessionScope,
      props.organizationId,
      "order-history",
      props.orderId,
    ],
    queryFn: () => orderApi.history(props.organizationId, props.orderId),
    enabled: Boolean(props.organizationId && props.sessionScope && current),
  });
  const workflowActions = useQuery({
    queryKey: [
      "v2",
      props.sessionScope,
      props.organizationId,
      "order-workflow-actions",
      props.orderId,
    ],
    queryFn: () => orderApi.workflowActions(props.organizationId, props.orderId),
    enabled: Boolean(props.organizationId && props.sessionScope && current),
  });

  useEffect(() => {
    if (!current) return;
    setCustomerId(current.order.customerContact.customerId ?? "");
    setContactId(current.order.customerContact.contactId ?? "");
    setPo(current.order.purchaseOrderNumber ?? "");
    setDueDate(current.order.requestedDueDate ?? "");
    setTermsCode(current.order.terms.termsCode ?? "");
    setNotes(current.order.terms.commercialNotes ?? "");
    setEditingLineId("");
    setFulfillmentMethod(current.order.requestedFulfillment?.method ?? "");
    setDestination({
      recipient:
        current.order.requestedFulfillment?.destination?.recipient ?? "",
      company: current.order.requestedFulfillment?.destination?.company ?? "",
      addressLine1:
        current.order.requestedFulfillment?.destination?.addressLine1 ?? "",
      addressLine2:
        current.order.requestedFulfillment?.destination?.addressLine2 ?? "",
      city: current.order.requestedFulfillment?.destination?.city ?? "",
      region: current.order.requestedFulfillment?.destination?.region ?? "",
      postalCode:
        current.order.requestedFulfillment?.destination?.postalCode ?? "",
      country: current.order.requestedFulfillment?.destination?.country ?? "",
      phone: current.order.requestedFulfillment?.destination?.phone ?? "",
    });
    setFulfillmentInstructions(
      current.order.requestedFulfillment?.instructions ?? "",
    );
    setAdjustmentCents(
      current.order.sellingAdjustment
        ? String(current.order.sellingAdjustment.cents)
        : "",
    );
    setAdjustmentReason(current.order.sellingAdjustment?.reason ?? "");
  }, [current?.order.orderId]);
  const apply = (result: OrderResult) => {
    queryClient.setQueryData(
      salesKeys.order(
        props.sessionScope,
        props.organizationId,
        result.order.order.orderId,
      ),
      result.order,
    );
    void queryClient.invalidateQueries({
      queryKey: salesKeys.orders(props.sessionScope, props.organizationId),
    });
    void queryClient.invalidateQueries({
      queryKey: [
        "v2",
        props.sessionScope,
        props.organizationId,
        "order-history",
        result.order.order.orderId,
      ],
    });
    void queryClient.invalidateQueries({
      queryKey: [
        "v2",
        props.sessionScope,
        props.organizationId,
        "order-invoice",
        result.order.order.orderId,
      ],
    });
    void queryClient.invalidateQueries({
      queryKey: [
        "v2",
        props.sessionScope,
        props.organizationId,
        "order-invoice-settlement",
      ],
    });
    complete("header");
    complete("line");
  };
  const update = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      orderApi.patch(
        props.organizationId,
        props.orderId,
        requestId("line", input),
        input,
      ),
    onSuccess: (result) => {
      apply(result);
      setEditingLineId("");
      setAddVersion((value) => value + 1);
      setNotice("Order saved.");
    },
    onError: (error) => {
      setNotice(message(error));
      if ((error as unknown as ApiError)?.code === "STALE_STATE") {
        complete("line");
        void order.refetch();
      }
    },
  });
  const saveHeader = useMutation({
    mutationFn: () => {
      const cents = adjustmentCents.trim()
        ? Number(adjustmentCents)
        : undefined;
      const requestedFulfillment = !fulfillmentMethod
        ? null
        : fulfillmentMethod === "pickup"
          ? {
              method: fulfillmentMethod,
              ...(fulfillmentInstructions.trim()
                ? { instructions: fulfillmentInstructions.trim() }
                : {}),
            }
          : {
              method: fulfillmentMethod,
              destination: Object.fromEntries(
                Object.entries(destination).filter(([, value]) => value.trim()),
              ) as { addressLine1: string; city: string },
              ...(fulfillmentInstructions.trim()
                ? { instructions: fulfillmentInstructions.trim() }
                : {}),
            };
      const sellingAdjustment =
        cents === undefined ? null : { cents, reason: adjustmentReason };
      const input = {
        expectedRevision: current!.revision,
        patch: {
          customerContact: {
            organizationId: props.organizationId,
            customerId,
            ...(contactId ? { contactId } : {}),
          },
          purchaseOrderNumber: po.trim() || null,
          requestedDueDate: dueDate || null,
          terms: {
            ...(termsCode.trim() ? { termsCode: termsCode.trim() } : {}),
            commercialNotes: notes,
          },
          requestedFulfillment,
          sellingAdjustment,
        },
      };
      return orderApi.patch(
        props.organizationId,
        props.orderId,
        requestId("header", input),
        input,
      );
    },
    onSuccess: (result) => {
      apply(result);
      setNotice("Order saved.");
    },
    onError: (error) => {
      setNotice(message(error));
      if ((error as unknown as ApiError)?.code === "STALE_STATE") {
        complete("header");
        void order.refetch();
      }
    },
  });
  const cancelOrder = useMutation({
    mutationFn: (reason: string) => orderApi.cancel(props.organizationId, props.orderId, requestId("cancel", { revision: current!.revision, reason }), current!.revision, reason),
    onSuccess: (result) => { apply(result); complete("cancel"); setNotice("Order cancelled. Billing and downstream history were preserved."); },
    onError: (error) => setNotice(message(error)),
  });
  const archiveOrder = useMutation({
    mutationFn: () => orderApi.archive(props.organizationId, props.orderId, requestId("archive", { revision: current!.revision }), current!.revision),
    onSuccess: (result) => { apply(result); complete("archive"); setNotice("Order archived. Its operational and financial history remains available."); },
    onError: (error) => setNotice(message(error)),
  });
  const unarchiveOrder = useMutation({
    mutationFn: () => orderApi.unarchive(props.organizationId, props.orderId, requestId("unarchive", { revision: current!.revision }), current!.revision),
    onSuccess: (result) => { apply(result); complete("unarchive"); setNotice("Order restored to terminal history visibility."); },
    onError: (error) => setNotice(message(error)),
  });
  const duplicateOrder = useMutation({
    mutationFn: () =>
      orderApi.duplicate(
        props.organizationId,
        props.orderId,
        requestId("duplicate", { orderId: props.orderId }),
      ),
    onSuccess: (result) => {
      setNotice(`New Order #${result.order.number.display} created.`);
      props.openOrder?.(result.order.order.orderId);
    },
    onError: (error) => setNotice(message(error)),
  });
  const refreshWorkflow = () => {
    void order.refetch();
    void workflowActions.refetch();
    void production.refetch();
    void fulfillment.refetch();
    void queryClient.invalidateQueries({
      queryKey: salesKeys.orders(props.sessionScope, props.organizationId),
    });
  };
  const directProduction = useMutation({
    mutationFn: (input: Readonly<{
      orderLineId: string;
      destination: "flatbed" | "roll";
      confirmed?: boolean;
    }>) =>
      orderApi.directProduction(
        props.organizationId,
        props.orderId,
        requestId("workflow-direct-production", input),
        input,
      ),
    onSuccess: (result) => {
      complete("workflow-direct-production");
      refreshWorkflow();
      setNotice(
        `Order line sent directly to ${stateLabel(result.destination ?? "production")}.`,
      );
    },
    onError: (error) => setNotice(message(error)),
  });
  const productionNotRequired = useMutation({
    mutationFn: (input: Readonly<{
      orderLineId: string;
      reason: string;
      confirmed?: boolean;
    }>) =>
      orderApi.productionNotRequired(
        props.organizationId,
        props.orderId,
        requestId("workflow-production-not-required", input),
        input,
      ),
    onSuccess: () => {
      complete("workflow-production-not-required");
      refreshWorkflow();
      setNotice("Production was marked not required for the eligible Order line.");
    },
    onError: (error) => setNotice(message(error)),
  });
  if (order.isLoading) return <div className="skeleton" />;
  if (order.error || !current)
    return <div className="notice error">{message(order.error)}</div>;
  const routeFor = (lineId: string) =>
    current.routes.find((route) => route.work.orderLineId === lineId);
  // Closed is a derived state. A permitted current commercial revision is
  // allowed to reopen it; cancelled and archived records stay read-only.
  const editable = props.canEdit && current.order.commercialState !== "cancelled" && !current.order.archivedAt;
  const change = (lineChanges: unknown[]) =>
    update.mutate({
      expectedRevision: current.revision,
      patch: {},
      lineChanges,
    });
  const selectedLine = current.order.lines.find(
    (line) => line.lineId === editingLineId,
  );
  const isAdding = editingLineId === "__add__";
  const fulfillmentAvailable = fulfillment.data?.lines.reduce(
    (total, line) => total + line.availableFulfillmentQuantity,
    0,
  );
  const requestedFulfillment = current.order.requestedFulfillment;
  const headerMetadata = (
    <>
      <div className="v2-sales-compact-meta">
        <div className="v2-sales-identity">
          <select
            className="v2-sales-customer-select"
            aria-label="Customer"
            value={customerId}
            disabled={!editable}
            onChange={(event) => {
              const next = clearContactForCustomerChange(event.target.value);
              setCustomerId(next.customerId);
              setContactId(next.contactId);
            }}
          >
            <option value="">Select Customer</option>
            {(customers.data ?? []).map((customer) =>
              customer.customerId ? (
                <option key={customer.customerId} value={customer.customerId}>
                  {customer.displayName}
                </option>
              ) : null,
            )}
          </select>
          <label className="v2-sales-contact-select">
            <small>Contact</small>
            <select
              aria-label="Contact"
              value={contactId}
              disabled={!editable || !customerId}
              onChange={(event) => setContactId(event.target.value)}
            >
              <option value="">Select Contact</option>
              {(contacts.data ?? []).map((contact) =>
                contact.contactId ? (
                  <option key={contact.contactId} value={contact.contactId}>
                    {contact.displayName}
                  </option>
                ) : null,
              )}
            </select>
          </label>
        </div>
        <label className="v2-sales-inline-fact">
          <small>PO #</small>
          <input
            aria-label="PO #"
            value={po}
            disabled={!editable}
            onChange={(event) => setPo(event.target.value)}
          />
        </label>
        <label className="v2-sales-inline-fact">
          <small>Requested Due</small>
          <input
            aria-label="Requested Due"
            type="date"
            value={dueDate}
            disabled={!editable}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </label>
        <div className="v2-sales-inline-fact">
          <small>Sales Rep</small>
          <span>—</span>
        </div>
        <label className="v2-sales-inline-fact">
          <small>Terms</small>
          <input aria-label="Terms" value={termsCode} disabled={!editable} onChange={(event) => setTermsCode(event.target.value)} placeholder="Terms code" />
        </label>
        <div className="v2-sales-inline-fact">
          <small>Fulfillment method</small>
          <button
            type="button"
            className="v2-sales-inline-button"
            onClick={() => props.openFulfillment?.(current.order.orderId)}
          >
            {requestedFulfillment
              ? stateLabel(requestedFulfillment.method)
              : "Not set"}
          </button>
        </div>
        <div className="v2-sales-inline-fact">
          <small>Available to fulfill</small>
          <span>
            {fulfillment.isSuccess
              ? `${fulfillmentAvailable ?? 0} available`
              : "Loading…"}
          </span>
        </div>
        <div className="v2-sales-inline-fact">
          <small>Job Name</small>
          <span>—</span>
        </div>
      </div>
      <div className="v2-order-owner-summaries">
        <OrderLifecycle order={current} onOpenRouting={props.openRouting} />
        <OrderProduction
          works={production.data}
          loading={production.isLoading}
          compact
          onOpen={(work) => props.openProduction?.(work.work.productionWorkId)}
        />
        <OrderBillingSummary
          invoice={billing.data}
          settlement={settlement.data}
          onOpen={(invoiceId) => props.openInvoice?.(invoiceId)}
        />
      </div>
    </>
  );
  const items = (
    <SalesDocumentSplit
      left={
        <section className="v2-sales-items">
          <header>
            <div>
              <h2>Items</h2>
              <p>
                {current.order.lines.length} line
                {current.order.lines.length === 1 ? "" : "s"}
              </p>
            </div>
            {editable && (
              <button
                type="button"
                className="v2-sales-add-line"
                disabled={update.isPending || !props.csrfReady}
                onClick={() => setEditingLineId("__add__")}
              >
                Add line
              </button>
            )}
          </header>
          <div className="v2-sales-items-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Configuration</th>
                  <th>Artwork</th>
                  <th>Qty</th>
                  <th>Calculated</th>
                  <th>Final</th>
                </tr>
              </thead>
              <tbody>
                {current.order.lines.map((line) => {
                  const productName = products.data?.find(
                    (product) => product.productId === line.productId,
                  )?.displayName;
                  return <tr
                    key={line.lineId}
                    className={
                      line.lineId === selectedLine?.lineId ? "is-selected" : ""
                    }
                    onClick={() =>
                      setEditingLineId((value) =>
                        value === line.lineId ? "" : line.lineId,
                      )
                    }
                  >
                    <td>
                      <button type="button">
                        <i>
                          {line.description.slice(0, 1).toUpperCase() || "P"}
                        </i>
                        <span>
                          <b>{productName ?? (line.description || "Product")}</b>
                          {productName && productName !== line.description && <small>{line.description}</small>}
                          {line.sellingPriceDecision.kind !== "calculated" && (
                            <em>
                              {stateLabel(line.sellingPriceDecision.kind)}
                            </em>
                          )}
                        </span>
                      </button>
                    </td>
                    <td>{lineConfiguration(line)}</td>
                    <td>
                      <OrderLineArtworkCompact
                        organizationId={props.organizationId}
                        orderLineId={line.lineId}
                        artwork={artwork.data ?? []}
                        loading={artwork.isLoading}
                        canView={props.canViewArtwork}
                        onOpen={() =>
                          props.openArtwork?.(
                            current.order.orderId,
                            line.lineId,
                          )
                        }
                      />
                    </td>
                    <td className="num">{line.quantity}</td>
                    <td className="num">{money(line.calculatedLineAmount)}</td>
                    <td className="num strong">
                      {money(line.sellingLineAmount)}
                    </td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          <footer>
            {current.order.sellingAdjustment && (
              <p className="v2-sales-route-note">
                Order adjustment{" "}
                {money({
                  cents: current.order.sellingAdjustment.cents,
                  currency: current.order.currency,
                })}
                : {current.order.sellingAdjustment.reason}
              </p>
            )}
            <SalesTotals
              calculated={current.totals.calculated}
              selling={current.totals.selling}
            />
          </footer>
        </section>
      }
      right={
        selectedLine ? (
          <OrderLineEditor
            line={selectedLine}
            route={routeFor(selectedLine.lineId)}
            {...props}
            artwork={artwork.data ?? []}
            artworkLoading={artwork.isLoading}
            onOpenArtwork={() =>
              props.openArtwork?.(current.order.orderId, selectedLine.lineId)
            }
            products={products.data ?? []}
            editable={editable}
            busy={update.isPending}
            onSave={(line) =>
              change([{ kind: "update", lineId: selectedLine.lineId, line }])
            }
            onSaveDescription={(description) =>
              change([
                {
                  kind: "update_description",
                  lineId: selectedLine.lineId,
                  description,
                },
              ])
            }
            onDuplicate={() =>
              change([{ kind: "duplicate", sourceLineId: selectedLine.lineId }])
            }
            onMoveUp={() => {
              const ids = current.order.lines.map((line) => line.lineId);
              const index = ids.indexOf(selectedLine.lineId);
              [ids[index - 1], ids[index]] = [ids[index]!, ids[index - 1]!];
              change([{ kind: "reorder", lineIds: ids }]);
            }}
            onMoveDown={() => {
              const ids = current.order.lines.map((line) => line.lineId);
              const index = ids.indexOf(selectedLine.lineId);
              [ids[index], ids[index + 1]] = [ids[index + 1]!, ids[index]!];
              change([{ kind: "reorder", lineIds: ids }]);
            }}
            canMoveUp={selectedLine.position > 1}
            canMoveDown={selectedLine.position < current.order.lines.length}
            onRemove={() =>
              change([{ kind: "remove", lineId: selectedLine.lineId }])
            }
            onClose={() => setEditingLineId("")}
          />
        ) : isAdding && editable ? (
          <section className="v2-sales-line-editor">
            <header>
              <div>
                <small>NEW LINE</small>
                <h2>Add item</h2>
              </div>
            </header>
            <QuoteLineEditor
              organizationId={props.organizationId}
              sessionScope={props.sessionScope}
              draftKey={`order:add:${current.order.orderId}:${addVersion}`}
              initialDraft={emptyQuoteLineDraft()}
              products={products.data ?? []}
              canOverridePrice={props.canOverridePrice}
              csrfReady={props.csrfReady}
              busy={update.isPending}
              submitLabel="Add line"
              onSubmit={(line: QuoteLineMutationInput) =>
                change([{ kind: "add", line }])
              }
              onCancel={() => setEditingLineId("")}
            />
          </section>
        ) : null
      }
    />
  );
  return (
    <section className="v2-sales-workspace v2-order-workspace">
      <button className="v2-sales-back" type="button" onClick={props.onBack}>
        ← Orders
      </button>
      {notice && <div className="notice">{notice}</div>}
      {current.order.commercialState === "open" && !current.completionEligibility.eligible && (
        <div className="notice" role="status">
          <strong>Order completion unavailable.</strong>{" "}
          {current.completionEligibility.blockers.map((blocker) => blocker.reason).join(" ")}
        </div>
      )}
      <SalesDocumentFrame
        documentType="Order"
        number={current.number.display}
        status={
          <>
            <LifecycleBadge value={current.order.commercialState} />
            {current.order.archivedAt && <LifecycleBadge value="archived" />}
            {current.order.sourceQuoteId && (
              <button
                className="v2-sales-source-link"
                type="button"
                onClick={() => props.openQuote?.(current.order.sourceQuoteId!)}
              >
                from Quote #{sourceQuote.data?.number.display ?? "…"}
              </button>
            )}
          </>
        }
        headerActions={
          <>
            <button
              className="button secondary"
              type="button"
              onClick={() =>
                props.openCustomer?.(current.order.customerContact.customerId)
              }
            >
              Open Customer
            </button>
            <button className="button secondary" type="button" onClick={() => window.open(`/v2/organizations/${encodeURIComponent(props.organizationId)}/orders/${encodeURIComponent(current.order.orderId)}/document.pdf`, "_blank", "noopener,noreferrer")}>Preview PDF</button>
            <button
              className="button secondary"
              type="button"
              disabled={!props.canCreate || duplicateOrder.isPending || !props.csrfReady}
              onClick={() => duplicateOrder.mutate()}
            >
              {duplicateOrder.isPending ? "Duplicating…" : "Duplicate Order"}
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => props.openFulfillment?.(current.order.orderId)}
            >
              Fulfillment
            </button>
            {props.openRouting && (
              <button
                className="button secondary"
                type="button"
                onClick={() => props.openRouting?.()}
              >
                Routing
              </button>
            )}
            {props.canViewProofing && current.order.lines[0] && (
              <button
                className="button secondary"
                type="button"
                onClick={() =>
                  props.openProofing?.(
                    current.order.orderId,
                    current.order.lines[0]!.lineId,
                    proofs.data?.[0]?.work.proofWorkId,
                  )
                }
              >
                Proofing
              </button>
            )}
            <button
              className="button"
              type="button"
              disabled={!editable || saveHeader.isPending || !props.csrfReady}
              onClick={() => saveHeader.mutate()}
            >
              {saveHeader.isPending ? "Saving…" : "Save"}
            </button>
            {props.canCancel && current.order.commercialState === "open" && (
              <button className="button secondary" type="button" disabled={cancelOrder.isPending || !props.csrfReady} onClick={() => {
                const reason = window.prompt("Cancellation reason (required):");
                if (reason?.trim()) cancelOrder.mutate(reason.trim());
                else if (reason !== null) setNotice("A cancellation reason is required.");
              }}>{cancelOrder.isPending ? "Cancelling…" : "Cancel Order"}</button>
            )}
            {props.canEdit && current.order.commercialState !== "open" && !current.order.archivedAt && (
              <button className="button secondary" type="button" disabled={archiveOrder.isPending || !props.csrfReady} onClick={() => archiveOrder.mutate()}>{archiveOrder.isPending ? "Archiving…" : "Archive Order"}</button>
            )}
            {props.canEdit && current.order.archivedAt && (
              <button className="button secondary" type="button" disabled={unarchiveOrder.isPending || !props.csrfReady} onClick={() => unarchiveOrder.mutate()}>{unarchiveOrder.isPending ? "Restoring…" : "Unarchive Order"}</button>
            )}
          </>
        }
        metadata={headerMetadata}
        panels={{
          Items: items,
          Artwork: (
            <OrderArtworkPanel
              organizationId={props.organizationId}
              lines={current.order.lines}
              artwork={artwork.data ?? []}
              loading={artwork.isLoading}
              canUpload={props.canViewArtwork && editable}
              onOpen={(lineId) =>
                props.openArtwork?.(current.order.orderId, lineId)
              }
            />
          ),
          Notes: (
            <section className="v2-sales-notes">
              <label className="field">
                Notes
                <textarea
                  aria-label="Commercial notes"
                  value={notes}
                  disabled={!editable}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </label>
              {editable && (
                <button
                  className="button"
                  type="button"
                  disabled={saveHeader.isPending || !props.csrfReady}
                  onClick={() => saveHeader.mutate()}
                >
                  {saveHeader.isPending ? "Saving…" : "Save notes"}
                </button>
              )}
            </section>
          ),
          Billing: (
            <OrderBilling
              invoice={billing.data}
              draft={current.draftInvoice}
              canView={props.canViewInvoice}
              onOpen={() =>
                billing.data &&
                props.openInvoice?.(billing.data.invoiceId)
              }
            />
          ),
          Fulfillment: (
            <OrderFulfillmentIntentEditor
              editable={editable}
              busy={saveHeader.isPending}
              csrfReady={props.csrfReady}
              method={fulfillmentMethod}
              destination={destination}
              instructions={fulfillmentInstructions}
              adjustmentCents={adjustmentCents}
              adjustmentReason={adjustmentReason}
              onMethod={setFulfillmentMethod}
              onDestination={(field, value) =>
                setDestination((currentDestination) => ({
                  ...currentDestination,
                  [field]: value,
                }))
              }
              onInstructions={setFulfillmentInstructions}
              onAdjustmentCents={setAdjustmentCents}
              onAdjustmentReason={setAdjustmentReason}
              onSave={() => saveHeader.mutate()}
              loading={fulfillment.isLoading}
              fulfillment={fulfillment.data}
              onOpen={() => props.openFulfillment?.(current.order.orderId)}
            />
          ),
          Proofing: (
            <OrderProofing
              works={proofs.data}
              loading={proofs.isLoading}
              onOpen={(work) => {
                const line = current.order.lines.find(
                  (candidate) => candidate.lineId === work.work.orderLineId,
                );
                if (line)
                  props.openProofing?.(
                    current.order.orderId,
                    line.lineId,
                    work.work.proofWorkId,
                  );
              }}
            />
          ),
          Routing: <OrderRouting order={current} onOpen={props.openRouting} />,
          Workflow: (
            <OrderWorkflowActions
              actions={workflowActions.data}
              lines={current.order.lines}
              loading={workflowActions.isLoading}
              busy={directProduction.isPending || productionNotRequired.isPending}
              csrfReady={props.csrfReady}
              onDirectProduction={(action, destination) => {
                if (
                  action.confirmationRequired &&
                  !window.confirm(
                    "This workflow policy requires confirmation before bypassing Prepress.",
                  )
                )
                  return;
                directProduction.mutate({
                  orderLineId: action.orderLineId,
                  destination,
                  ...(action.confirmationRequired ? { confirmed: true } : {}),
                });
              }}
              onProductionNotRequired={(action) => {
                const reason = window.prompt(
                  "Why is Production not required for this Order line?",
                );
                if (!reason?.trim()) return;
                if (
                  action.confirmationRequired &&
                  !window.confirm(
                    "This workflow policy requires confirmation before removing the Production obligation.",
                  )
                )
                  return;
                productionNotRequired.mutate({
                  orderLineId: action.orderLineId,
                  reason: reason.trim(),
                  ...(action.confirmationRequired ? { confirmed: true } : {}),
                });
              }}
            />
          ),
          Production: (
            <OrderProduction
              works={production.data}
              loading={production.isLoading}
              onOpen={(work) =>
                props.openProduction?.(work.work.productionWorkId)
              }
            />
          ),
          History: (
            <OrderSalesHistory
              loading={history.isLoading}
              events={history.data}
            />
          ),
        }}
      />
    </section>
  );
};

const OrderLifecycle = ({
  order,
  onOpenRouting,
}: Readonly<{ order: OrderRead; onOpenRouting?: () => void }>) => (
  <div className="v2-order-lifecycle" aria-label="Order status">
    <span data-state="active">
      Order <b>{stateLabel(order.order.commercialState)}</b>
    </span>
    {order.routes.length ? (
      order.routes.map((route) => {
        const line = order.order.lines.find(
          (candidate) => candidate.lineId === route.work.orderLineId,
        );
        const presentation = orderRoutePresentation(route);
        return (
          <span
            key={route.routeInstanceId ?? route.work.orderLineId}
            data-state={presentation.tone}
          >
            <button
              className="v2-sales-inline-button"
              type="button"
              onClick={onOpenRouting}
            >
              Routing{line ? ` · ${line.description}` : ""}{" "}
              <b>{presentation.summary}</b>
            </button>
          </span>
        );
      })
    ) : (
      <span data-state="neutral">
        Routing <b>No route</b>
      </span>
    )}
    {order.draftInvoice && (
      <span data-state="neutral">
        Invoice <b>{order.draftInvoice.lifecycle === "draft" ? "Order-backed" : stateLabel(order.draftInvoice.lifecycle)}</b>
      </span>
    )}
  </div>
);

/**
 * The backend returns only currently eligible line actions. This component
 * deliberately does not reconstruct route, artwork, proof, or policy rules.
 */
export const OrderWorkflowActions = ({
  actions,
  lines,
  loading,
  busy,
  csrfReady,
  onDirectProduction,
  onProductionNotRequired,
}: Readonly<{
  actions?: readonly import("./api").OrderWorkflowActionEligibility[];
  lines: readonly SalesLine[];
  loading: boolean;
  busy: boolean;
  csrfReady: boolean;
  onDirectProduction: (
    action: import("./api").OrderWorkflowActionEligibility,
    destination: "flatbed" | "roll",
  ) => void;
  onProductionNotRequired: (
    action: import("./api").OrderWorkflowActionEligibility,
  ) => void;
}>) => {
  if (loading)
    return <section className="v2-order-tab"><h2>Workflow</h2><p>Loading eligible workflow actions…</p></section>;
  if (!actions?.length) return null;
  return (
    <section className="v2-order-tab v2-order-workflow-actions">
      <header>
        <div>
          <h2>Workflow</h2>
          <p>Only actions currently authorized by the canonical workflow are shown.</p>
        </div>
      </header>
      <ul>
        {actions.map((action) => {
          const line = lines.find((candidate) => candidate.lineId === action.orderLineId);
          const lineName = line?.description || "Order line";
          if (action.action === "direct_production")
            return <li key={`${action.action}:${action.orderLineId}`}>
              <b>{lineName}</b>
              <p>{action.eligibilityReason}</p>
              <div>
                {(action.allowedDestinations ?? []).map((destination) => (
                  <button
                    key={destination}
                    className="button secondary"
                    type="button"
                    disabled={busy || !csrfReady}
                    onClick={() => onDirectProduction(action, destination)}
                  >
                    Send to {stateLabel(destination)}
                  </button>
                ))}
              </div>
            </li>;
          return <li key={`${action.action}:${action.orderLineId}`}>
            <b>{lineName}</b>
            <p>{action.eligibilityReason}</p>
            <button
              className="button secondary"
              type="button"
              disabled={busy || !csrfReady || action.reasonRequired !== true}
              onClick={() => onProductionNotRequired(action)}
            >
              Production not required
            </button>
          </li>;
        })}
      </ul>
    </section>
  );
};

export const OrderRouting = ({
  order,
  onOpen,
}: Readonly<{ order: OrderRead; onOpen?: () => void }>) => (
  <section className="v2-order-tab">
    <header>
      <div>
        <h2>Routing</h2>
        <p>Frozen Order-line routes are owned and progressed by Routing.</p>
      </div>
      {onOpen && (
        <button className="button secondary" type="button" onClick={onOpen}>
          Open Routing
        </button>
      )}
    </header>
    {order.routes.length ? (
      <dl>
        {order.routes.map((route) => {
          const line = order.order.lines.find(
            (candidate) => candidate.lineId === route.work.orderLineId,
          );
          const presentation = orderRoutePresentation(route);
          return (
            <div key={route.routeInstanceId ?? route.work.orderLineId}>
              <dt>
                {line
                  ? `Line ${line.position}: ${line.description}`
                  : "Order line"}
              </dt>
              <dd>
                {presentation.summary}
                {presentation.prerequisite && (
                  <>
                    <br />
                    {presentation.prerequisite}
                  </>
                )}
                {presentation.reason && (
                  <>
                    <br />
                    <small>{presentation.reason}</small>
                  </>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    ) : (
      <p>No route</p>
    )}
  </section>
);

/** Uses the narrow Sales line-description mutation; it never submits Product configuration. */
export const OrderLineDescriptionEditor = ({
  description: persistedDescription,
  editable,
  busy,
  csrfReady,
  onSave,
}: Readonly<{
  description: string;
  editable: boolean;
  busy: boolean;
  csrfReady: boolean;
  onSave: (description: string) => void;
}>) => {
  const [description, setDescription] = useState(persistedDescription);
  useEffect(() => setDescription(persistedDescription), [persistedDescription]);
  return <label className="field">
    <span>Order line description</span>
    <div className="v2-sales-description-edit">
      <input aria-label="Order line description" value={description} disabled={!editable || busy} onChange={(event) => setDescription(event.target.value)} />
      {editable && <button className="button secondary" type="button" disabled={busy || !csrfReady || !description.trim() || description.trim() === persistedDescription} onClick={() => onSave(description)}>Save description</button>}
    </div>
    <small>This updates the commercial line only; Product, frozen configuration, and calculated pricing remain unchanged.</small>
    {!editable && <p className="v2-sales-permission-note">This Order is locked. Commercial line changes are unavailable after the Order leaves the Open state or your access does not allow Order editing.</p>}
  </label>;
};

const OrderLineEditor = ({
  line,
  route,
  organizationId,
  sessionScope,
  canOverridePrice,
  canViewArtwork,
  csrfReady,
  artwork,
  artworkLoading,
  onOpenArtwork,
  products,
  editable,
  busy,
  onSave,
  onSaveDescription,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  onRemove,
  onClose,
}: Readonly<{
  line: SalesLine;
  route?: OrderRead["routes"][number];
  organizationId: string;
  sessionScope: string;
  canOverridePrice: boolean;
  canViewArtwork: boolean;
  csrfReady: boolean;
  artwork: readonly ArtworkOrderProjection[];
  artworkLoading: boolean;
  onOpenArtwork: () => void;
  products: readonly { productId?: string; displayName: string }[];
  editable: boolean;
  busy: boolean;
  onSave: (line: QuoteLineMutationInput) => void;
  onSaveDescription: (description: string) => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRemove: () => void;
  onClose: () => void;
}>) => {
  const routing = route ? orderRoutePresentation(route) : undefined;
  const productName =
    products.find((product) => product.productId === line.productId)
      ?.displayName ?? "Product retained on this Order line";
  return (
    <section className="v2-sales-line-editor">
      <header>
        <div>
          <small>LINE {line.position}</small>
          <h2>{line.description || "Order line"}</h2>
        </div>
        {routing ? (
          <span className="v2-sales-route-note">
            Routing · {routing.summary}
            {routing.reason ? ` · ${routing.reason}` : ""}
          </span>
        ) : editable ? (
          <button
            className="v2-sales-remove-line"
            type="button"
            disabled={busy || !csrfReady}
            onClick={onRemove}
          >
            Remove
          </button>
        ) : null}
        {editable && (
          <div className="v2-sales-line-actions">
            <button className="button secondary" type="button" disabled={busy || !csrfReady} onClick={onDuplicate}>Duplicate line</button>
            <button className="button secondary" type="button" disabled={busy || !csrfReady || !canMoveUp} onClick={onMoveUp}>Move up</button>
            <button className="button secondary" type="button" disabled={busy || !csrfReady || !canMoveDown} onClick={onMoveDown}>Move down</button>
          </div>
        )}
      </header>
      <section
        className="v2-order-line-editor-section"
        aria-labelledby="order-line-commercial"
      >
        <h3 id="order-line-commercial">Commercial</h3>
        <dl className="v2-order-line-commercial-facts">
          <div>
            <dt>Product</dt>
            <dd>{productName}</dd>
          </div>
          <div>
            <dt>Quantity</dt>
            <dd>{line.quantity}</dd>
          </div>
          <div>
            <dt>Calculated</dt>
            <dd>{money(line.calculatedLineAmount)}</dd>
          </div>
          <div>
            <dt>Final</dt>
            <dd>{money(line.sellingLineAmount)}</dd>
          </div>
        </dl>
        <OrderLineDescriptionEditor description={line.description} editable={editable} busy={busy} csrfReady={csrfReady} onSave={onSaveDescription} />
        {editable && (
          <>
            {!canOverridePrice && (
              <p className="v2-sales-permission-note">
                Price overrides are unavailable for this permission set.
              </p>
            )}
            <QuoteLineEditor
              organizationId={organizationId}
              sessionScope={sessionScope}
              draftKey={`order:edit:${line.lineId}`}
              initialDraft={draftFromQuoteLine(line)}
              initializeFromPersistedLine
              productEditable={false}
              showProductField={false}
              showConfigurationFields={false}
              products={products as never}
              canOverridePrice={canOverridePrice}
              csrfReady={csrfReady}
              busy={busy}
              submitLabel="Save quantity or price"
              onSubmit={onSave}
              onCancel={onClose}
            />
          </>
        )}
      </section>
      <section
        className="v2-order-line-editor-section"
        aria-labelledby="order-line-configuration"
      >
        <h3 id="order-line-configuration">Configuration</h3>
        <p className="v2-order-line-configuration">{lineConfiguration(line)}</p>
        <small>Frozen configuration recorded on this Order line.</small>
      </section>
      <OrderLineArtworkDetail
        organizationId={organizationId}
        orderLineId={line.lineId}
        artwork={artwork}
        loading={artworkLoading}
        canView={canViewArtwork}
        onOpen={onOpenArtwork}
      />
    </section>
  );
};

const OrderBilling = ({
  invoice,
  draft,
  canView,
  onOpen,
}: Readonly<{
  invoice?: import("./api").InvoiceRead | null;
  draft?: OrderRead["draftInvoice"];
  canView: boolean;
  onOpen: () => void;
}>) => {
  if (!invoice && !draft)
    return <SalesDocumentEmpty>No invoice is available for this Order.</SalesDocumentEmpty>;
  return (
    <section className="v2-order-tab">
      <header>
        <div>
          <h2>Billing</h2>
          <p>{canView ? "Current order-backed invoice" : "Invoice access is unavailable."}</p>
        </div>
        {canView && (
          <button className="button secondary" type="button" onClick={onOpen}>
            Open Invoice
          </button>
        )}
      </header>
      <dl>
        <div>
          <dt>Status</dt>
          <dd>{(invoice?.lifecycle ?? draft!.lifecycle) === "draft" ? "Order-backed" : stateLabel(invoice?.lifecycle ?? draft!.lifecycle)}</dd>
        </div>
        <div>
          <dt>Lines</dt>
          <dd>{invoice?.lines.length ?? draft!.lineCount}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>{money(invoice?.total ?? draft!.total)}</dd>
        </div>
      </dl>
    </section>
  );
};

const OrderFulfillment = ({
  loading,
  fulfillment,
  onOpen,
}: Readonly<{
  loading: boolean;
  fulfillment?: import("./api").FulfillmentWorkspaceOrder;
  onOpen: () => void;
}>) => (
  <section className="v2-order-tab">
    <header>
      <div>
        <h2>Fulfillment</h2>
        <p>
          {loading
            ? "Loading…"
            : fulfillment
              ? `${fulfillment.handoffs.length} recorded handoff${fulfillment.handoffs.length === 1 ? "" : "s"}`
              : "Fulfillment details are unavailable."}
        </p>
      </div>
      <button className="button secondary" type="button" onClick={onOpen}>
        Open Fulfillment
      </button>
    </header>
    {fulfillment && (
      <dl>
        {fulfillment.lines.map((line) => (
          <div key={line.orderLineId}>
            <dt>{line.description}</dt>
            <dd>
              {line.availableFulfillmentQuantity} available ·{" "}
              {line.remainingFulfillmentQuantity} not handed off
            </dd>
          </div>
        ))}
      </dl>
    )}
  </section>
);

const OrderFulfillmentIntentEditor = ({
  editable,
  busy,
  csrfReady,
  method,
  destination,
  instructions,
  adjustmentCents,
  adjustmentReason,
  onMethod,
  onDestination,
  onInstructions,
  onAdjustmentCents,
  onAdjustmentReason,
  onSave,
  loading,
  fulfillment,
  onOpen,
}: Readonly<{
  editable: boolean;
  busy: boolean;
  csrfReady: boolean;
  method: "" | "pickup" | "shipping" | "local_delivery";
  destination: Record<string, string>;
  instructions: string;
  adjustmentCents: string;
  adjustmentReason: string;
  onMethod: (value: "" | "pickup" | "shipping" | "local_delivery") => void;
  onDestination: (field: string, value: string) => void;
  onInstructions: (value: string) => void;
  onAdjustmentCents: (value: string) => void;
  onAdjustmentReason: (value: string) => void;
  onSave: () => void;
  loading: boolean;
  fulfillment?: import("./api").FulfillmentWorkspaceOrder;
  onOpen: () => void;
}>) => (
  <section className="v2-order-tab v2-order-fulfillment-intent">
    <header>
      <div>
        <h2>Requested fulfillment</h2>
        <p>
          {loading
            ? "Loading current handoff context…"
            : fulfillment
              ? `${fulfillment.handoffs.length} recorded handoff${fulfillment.handoffs.length === 1 ? "" : "s"}; physical handoffs remain in Fulfillment.`
              : "Sales-owned request; Fulfillment owns physical handoffs."}
        </p>
      </div>
      <button className="button secondary" type="button" onClick={onOpen}>
        Open Fulfillment
      </button>
    </header>
    <label className="field">
      <span>Method</span>
      <select
        aria-label="Requested fulfillment method"
        value={method}
        disabled={!editable || busy}
        onChange={(event) =>
          onMethod(
            event.target.value as "" | "pickup" | "shipping" | "local_delivery",
          )
        }
      >
        <option value="">Not set</option>
        <option value="pickup">Pickup</option>
        <option value="shipping">Shipping</option>
        <option value="local_delivery">Local delivery</option>
      </select>
    </label>
    {(method === "shipping" || method === "local_delivery") && (
      <div className="v2-order-destination-grid">
        <label className="field">
          <span>Recipient</span>
          <input
            value={destination.recipient}
            disabled={!editable || busy}
            onChange={(event) => onDestination("recipient", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Company</span>
          <input
            value={destination.company}
            disabled={!editable || busy}
            onChange={(event) => onDestination("company", event.target.value)}
          />
        </label>
        <label className="field wide">
          <span>Address</span>
          <input
            aria-label="Destination address"
            value={destination.addressLine1}
            disabled={!editable || busy}
            onChange={(event) =>
              onDestination("addressLine1", event.target.value)
            }
          />
        </label>
        <label className="field wide">
          <span>Address 2</span>
          <input
            value={destination.addressLine2}
            disabled={!editable || busy}
            onChange={(event) =>
              onDestination("addressLine2", event.target.value)
            }
          />
        </label>
        <label className="field">
          <span>City</span>
          <input
            aria-label="Destination city"
            value={destination.city}
            disabled={!editable || busy}
            onChange={(event) => onDestination("city", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Region</span>
          <input
            value={destination.region}
            disabled={!editable || busy}
            onChange={(event) => onDestination("region", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Postal code</span>
          <input
            value={destination.postalCode}
            disabled={!editable || busy}
            onChange={(event) =>
              onDestination("postalCode", event.target.value)
            }
          />
        </label>
        <label className="field">
          <span>Country</span>
          <input
            value={destination.country}
            disabled={!editable || busy}
            onChange={(event) => onDestination("country", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Phone</span>
          <input
            value={destination.phone}
            disabled={!editable || busy}
            onChange={(event) => onDestination("phone", event.target.value)}
          />
        </label>
      </div>
    )}
    <label className="field">
      <span>Instructions</span>
      <textarea
        aria-label="Fulfillment instructions"
        value={instructions}
        disabled={!editable || busy}
        onChange={(event) => onInstructions(event.target.value)}
      />
    </label>
    <div className="v2-order-adjustment">
      <label className="field">
        <span>Order adjustment (cents)</span>
        <input
          inputMode="numeric"
          aria-label="Order adjustment cents"
          value={adjustmentCents}
          disabled={!editable || busy}
          onChange={(event) => onAdjustmentCents(event.target.value)}
          placeholder="0"
        />
      </label>
      <label className="field">
        <span>Adjustment reason</span>
        <input
          aria-label="Order adjustment reason"
          value={adjustmentReason}
          disabled={!editable || busy || !adjustmentCents.trim()}
          onChange={(event) => onAdjustmentReason(event.target.value)}
        />
      </label>
    </div>
    <p className="v2-sales-permission-note">
      An adjustment is explicit: the final Order total is calculated line
      selling total plus this signed amount.
    </p>
    {editable && (
      <button
        className="button"
        type="button"
        disabled={
          busy ||
          !csrfReady ||
          ((method === "shipping" || method === "local_delivery") &&
            (!destination.addressLine1.trim() || !destination.city.trim())) ||
          (adjustmentCents.trim() !== "" &&
            (!Number.isSafeInteger(Number(adjustmentCents)) ||
              Number(adjustmentCents) === 0 ||
              !adjustmentReason.trim()))
        }
        onClick={onSave}
      >
        {busy ? "Saving…" : "Save requested fulfillment"}
      </button>
    )}
  </section>
);

const OrderSalesHistory = ({
  loading,
  events,
}: Readonly<{
  loading: boolean;
  events?: readonly {
    eventType: string;
    occurredAt: string;
    summary: string;
  }[];
}>) => (
  <section className="v2-sales-history">
    <header>
      <h2>Sales history</h2>
      <p>Canonical Sales audit evidence only.</p>
    </header>
    {loading ? (
      <p>Loading…</p>
    ) : !events?.length ? (
      <p>No recorded Sales changes.</p>
    ) : (
      <ol>
        {events.map((event) => (
          <li key={`${event.eventType}:${event.occurredAt}`}>
            <b>{event.summary}</b>
            <span>{new Date(event.occurredAt).toLocaleString()}</span>
          </li>
        ))}
      </ol>
    )}
  </section>
);

const OrderProofing = ({
  works,
  loading,
  onOpen,
}: Readonly<{
  works?: readonly ProofWorkProjection[];
  loading: boolean;
  onOpen: (work: ProofWorkProjection) => void;
}>) => (
  <section className="v2-order-tab">
    <header>
      <div>
        <h2>Proofing</h2>
        <p>
          {loading
            ? "Loading…"
            : works?.length
              ? `${works.length} ProofWork record${works.length === 1 ? "" : "s"}`
              : "No Proofing work has been started."}
        </p>
      </div>
    </header>
    {works?.length ? (
      <dl>
        {works.map((work) => {
          const latest = work.versions[0];
          return (
            <div key={work.work.proofWorkId}>
              <dt>Proof #{work.work.proofWorkId.slice(0, 8)}</dt>
              <dd>
                {latest
                  ? `Version ${latest.version.sequence}${latest.response ? ` · ${stateLabel(latest.response.outcome)}` : latest.version.issuedAt ? " · Awaiting response" : " · Draft"}`
                  : "No version"}{" "}
                <button
                  className="v2-sales-inline-button"
                  type="button"
                  onClick={() => onOpen(work)}
                >
                  Open
                </button>
              </dd>
            </div>
          );
        })}
      </dl>
    ) : null}
  </section>
);

export const OrderProduction = ({
  works,
  loading,
  compact,
  onOpen,
}: Readonly<{
  works?: readonly ProductionWorkProjection[];
  loading: boolean;
  compact?: boolean;
  onOpen: (work: ProductionWorkProjection) => void;
}>) => (
  <section className={compact ? "v2-order-production-compact" : "v2-order-tab"}>
    {compact ? (
      <h3>Production</h3>
    ) : (
      <header>
        <div>
          <h2>Production</h2>
          <p>Production-owned work is read-only here.</p>
        </div>
      </header>
    )}
    <div className="v2-order-owner-summary-value">
      {loading ? (
        <span>Loading…</span>
      ) : !works?.length ? (
        <span>No Production work</span>
      ) : (
        works.map((work) => (
          <button
            key={work.work.productionWorkId}
            className="v2-sales-inline-button"
            type="button"
            onClick={() => onOpen(work)}
          >
            {work.completedGoodQuantity}/{work.work.orderedQuantity} complete
            {work.attempts.at(-1)
              ? ` · ${stateLabel(work.attempts.at(-1)!.stationKey)}`
              : ""}
          </button>
        ))
      )}
    </div>
  </section>
);

export const OrderBillingSummary = ({
  invoice,
  settlement,
  onOpen,
}: Readonly<{
  invoice?: import("./api").InvoiceRead | null;
  settlement?: import("./api").FinancialInvoiceRead;
  onOpen: (invoiceId: string) => void;
}>) =>
  !invoice ? (
    <section className="v2-order-billing-compact">
      <h3>Billing</h3>
      <div className="v2-order-owner-summary-value">No invoice</div>
    </section>
  ) : (
    <section className="v2-order-billing-compact">
      <h3>Billing</h3>
      <button
        className="v2-sales-inline-button v2-order-billing-summary"
        type="button"
        onClick={() => onOpen(invoice.invoiceId)}
      >
        <strong>Invoice {invoice.sourceOrderNumber ?? "record"}</strong>
        <span>
          {invoice.lifecycle === "draft" ? "Order-backed" : stateLabel(invoice.lifecycle)} · {money(invoice.total)}
        </span>
        <small>
          Paid{" "}
          {money(
            settlement?.settlement.paid ?? {
              cents: 0,
              currency: invoice.currency,
            },
          )}{" "}
          · Balance {money(settlement?.settlement.balance ?? invoice.total)}
        </small>
      </button>
    </section>
  );

const bytes = (value: number) =>
  value < 1024 * 1024
    ? `${Math.max(1, Math.round(value / 1024))} KB`
    : `${(value / (1024 * 1024)).toFixed(1)} MB`;
const artworkRole = (value: ArtworkOrderProjection) =>
  [
    stateLabel(value.assignment.purpose),
    value.assignment.side,
    value.assignment.sourcePageIndex !== undefined
      ? `Page ${value.assignment.sourcePageIndex + 1}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
const OrderArtworkPanel = ({
  organizationId,
  lines,
  artwork,
  loading,
  canUpload,
  onOpen,
}: Readonly<{
  organizationId: string;
  lines: readonly { lineId: string; description: string }[];
  artwork: readonly ArtworkOrderProjection[];
  loading: boolean;
  canUpload: boolean;
  onOpen: (lineId: string) => void;
}>) => (
  <section className="v2-order-tab">
    <header>
      <div>
        <h2>Artwork</h2>
        <p>
          {loading
            ? "Loading…"
            : artwork.length
              ? `${artwork.length} file${artwork.length === 1 ? "" : "s"}`
              : "No artwork is attached."}
        </p>
      </div>
    </header>
    {!loading && (
      <ul className="v2-order-artwork">
        {lines.map((line) => {
          const assigned = artwork.filter(
            (entry) => entry.assignment.orderLineId === line.lineId,
          );
          return (
            <li key={line.lineId}>
              <b>{line.description || "Order line"}</b>
              {assigned.length ? (
                assigned.map((entry) => (
                  <div
                    key={entry.assignment.id}
                    className="v2-order-art-preview"
                  >
                    <iframe
                      title={`Artwork preview ${entry.file.displayFilename}`}
                      src={`/v2/organizations/${encodeURIComponent(organizationId)}/artwork/files/${encodeURIComponent(entry.file.id)}/content#page=${(entry.assignment.sourcePageIndex ?? 0) + 1}`}
                    />
                    <span>
                      {entry.file.displayFilename} · {artworkRole(entry)} ·{" "}
                      {bytes(entry.file.byteSize)}
                    </span>
                  </div>
                ))
              ) : (
                <span>No artwork attached</span>
              )}
              {canUpload && (
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => onOpen(line.lineId)}
                >
                  Open Artwork
                </button>
              )}
            </li>
          );
        })}
      </ul>
    )}
  </section>
);
