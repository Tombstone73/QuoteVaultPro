import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  money,
  newBusinessRequestId,
  contactApi,
  type QuoteSendReadiness,
  orderApi,
  quoteApi,
  clearV2ApiSessionState,
  type ApiError,
  type LegacyCommercialDetail,
  type QuoteRead,
  type QuoteResult,
  type SalesLine,
  type Selection,
} from "./api";
import {
  applyAuthoritativeQuoteResult,
  clearV2SessionQueryState,
  reconcileForbiddenQuoteMutation,
} from "./quoteCache";
import { QuoteLineEditor } from "./QuoteLineEditor";
import { OrderWorkspace } from "./OrderWorkspace";
import { LifecycleBadge, SalesTotals } from "./SalesDocumentParts";
import {
  SalesDocumentEmpty,
  SalesDocumentFrame,
  SalesDocumentSplit,
} from "./SalesDocumentWorkspace";
import {
  clearContactForCustomerChange,
  draftFromQuoteLine,
  emptyQuoteLineDraft,
  type QuoteLineMutationInput,
} from "./quoteFormModel";
import {
  quoteKeys,
  salesKeys,
  useQuoteFormContacts,
  useQuoteFormCustomers,
  useQuoteFormProducts,
  useSalesOrders,
} from "./quoteFormQueries";
import { AppearanceWorkspace } from "./AppearanceWorkspace";
import { QuotesList } from "./QuotesList";
import { OrdersList } from "./OrdersList";
import type { VisualAppearance } from "./appearance";
import { V2VisualShell, type V2VisualPage } from "./VisualShell";
import { ProofingWorkspace } from "./ProofingWorkspace";
import { PrepressWorkspace } from "./PrepressWorkspace";
import { ProductionWorkspace } from "./ProductionWorkspace";
import { FulfillmentWorkspace } from "./FulfillmentWorkspace";
import { FinanceWorkspace } from "./FinanceWorkspace";
import { CustomerWorkspace } from "./CustomerWorkspace";
import { ContactsWorkspace } from "./ContactsWorkspace";
import { ProductWorkspace } from "./ProductWorkspace";
import { ArtworkWorkspace } from "./ArtworkWorkspace";
import { RoutingWorkspace } from "./RoutingWorkspace";
import { CommandCenter } from "./CommandCenter";
import { FormulaLibraryWorkspace } from "./FormulaLibraryWorkspace";
import { SalesEntryWorkspace } from "./SalesEntryWorkspace";
import { SalesTaxSettingsWorkspace } from "./SalesTaxSettingsWorkspace";
import { EmailSettingsWorkspace } from "./EmailSettingsWorkspace";
import { SettingsWorkspace } from "./SettingsWorkspace";
import { OrganizationSettingsWorkspace } from "./OrganizationSettingsWorkspace";
import { NumberingSettingsWorkspace } from "./NumberingSettingsWorkspace";
import { TeamAccessWorkspace } from "./TeamAccessWorkspace";
import { orderConfigurationPresentation } from "./orderConfigurationPresentation";
import { quoteLineProductPresentation } from "./quoteLinePresentation";
import { quoteRouteMode } from "./quoteRouteMode";
import {
  legacyProductEditorRedirect,
  productBuilderPath,
  productPath,
  readFormulaAuthoringContext,
  pushArtworkFileLocation,
  pushArtworkLocation,
  pushContactLocation,
  pushCustomerLocation,
  pushFulfillmentLocation,
  pushInvoiceLocation,
  pushNewProductBuilderLocation,
  pushOrderLocation,
  pushPrepressLocation,
  pushProductBuilderLocation,
  pushProductLocation,
  pushProductionLocation,
  pushProductionWorkLocation,
  pushProofingLocation,
  pushNewQuoteLocation,
  pushQuoteLocation,
  pushWorkspaceLocation,
  readWorkspaceLocation,
  type FormulaAuthoringContext,
} from "./productRouting";

const errorText = (error: unknown) => {
  const value = error as ApiError;
  if (value?.code === "STALE_STATE")
    return "This Quote changed elsewhere. Reload it before saving your draft.";
  if (value?.code === "FORBIDDEN")
    return "You do not have permission for that Quote action.";
  if (value?.code === "NOT_FOUND")
    return "The Quote, customer, contact, or Product is unavailable in this organization.";
  return value?.message ?? "The Quote service is unavailable.";
};

const Status = LifecycleBadge;

const dateInputValue = (value?: string): string =>
  /^\d{4}-\d{2}-\d{2}/u.exec(value ?? "")?.[0] ?? "";

export const App = ({
  appearance,
  setAppearance,
}: {
  appearance: VisualAppearance;
  setAppearance: (patch: Partial<VisualAppearance>) => void;
}) => {
  const initialLocation =
    typeof window === "undefined" ? null : readWorkspaceLocation();
  const [page, setPage] = useState<V2VisualPage>(
    () => initialLocation?.page ?? "home",
  );
  const [organizationId, setOrganizationId] = useState("");
  const [sessionScope, setSessionScope] = useState("");
  const sessionScopeRef = useRef(sessionScope);
  const organizationRef = useRef(organizationId);
  useEffect(() => {
    organizationRef.current = organizationId;
  }, [organizationId]);
  useEffect(() => {
    if (organizationId) return;
    try {
      const persisted = sessionStorage.getItem("ph.v2.organization-id")?.trim();
      if (persisted) setOrganizationId(persisted);
    } catch {
      /* Stored scope is optional and never authority. */
    }
  }, []);
  useEffect(() => {
    try {
      if (organizationId)
        sessionStorage.setItem("ph.v2.organization-id", organizationId);
      else sessionStorage.removeItem("ph.v2.organization-id");
    } catch {
      /* Stored scope is optional and never authority. */
    }
  }, [organizationId]);
  const [quoteId, setQuoteId] = useState(
    () =>
      initialLocation?.page === "quotes" ? initialLocation.quoteId ?? "" : "",
  );
  const [newQuoteRequested, setNewQuoteRequested] = useState(
    () => initialLocation?.page === "quotes" && initialLocation.newQuote === true,
  );
  const [orderId, setOrderId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [contactId, setContactId] = useState("");
  const [productId, setProductId] = useState("");
  const [productBuilderId, setProductBuilderId] = useState("");
  const [newProductBuilder, setNewProductBuilder] = useState(false);
  const [formulaAuthoringContext, setFormulaAuthoringContext] = useState<FormulaAuthoringContext | null>(null);
  const [invoiceId, setInvoiceId] = useState("");
  const [fulfillmentOrderId, setFulfillmentOrderId] = useState("");
  const [productionStation, setProductionStation] = useState<
    "flatbed" | "roll" | undefined
  >();
  const [productionWorkId, setProductionWorkId] = useState("");
  const [artworkOrderId, setArtworkOrderId] = useState("");
  const [artworkLineId, setArtworkLineId] = useState("");
  const [artworkFileId, setArtworkFileId] = useState("");
  const [proofWorkId, setProofWorkId] = useState("");
  const [proofOrderId, setProofOrderId] = useState("");
  const [proofLineId, setProofLineId] = useState("");
  const [prepressLineId, setPrepressLineId] = useState("");
  const [prepressUnitId, setPrepressUnitId] = useState("");
  const [notice, setNotice] = useState("");
  const queryClient = useQueryClient();
  const quote = useQuery({
    queryKey: quoteKeys.quote(sessionScope, organizationId, quoteId),
    queryFn: () => quoteApi.get(organizationId, quoteId),
    enabled: Boolean(sessionScope && organizationId && quoteId),
  });
  const bootstrap = useQuery({
    queryKey: quoteKeys.bootstrap(sessionScope, organizationId),
    queryFn: () => quoteApi.bootstrap(organizationId),
    enabled: Boolean(organizationId),
    staleTime: 0,
  });
  useEffect(() => {
    const nextScope = bootstrap.data?.sessionScope;
    if (!nextScope) return;
    if (sessionScopeRef.current && sessionScopeRef.current !== nextScope) {
      clearV2SessionQueryState(queryClient);
      setOrganizationId("");
      setQuoteId("");
      setNewQuoteRequested(false);
      setOrderId("");
      setCustomerId("");
      setContactId("");
      setProductId("");
      setProductBuilderId("");
      setNewProductBuilder(false);
      setFormulaAuthoringContext(null);
      setInvoiceId("");
      setFulfillmentOrderId("");
      setProductionStation(undefined);
      setProductionWorkId("");
      setArtworkOrderId("");
      setArtworkLineId("");
      setProofWorkId("");
      setProofOrderId("");
      setProofLineId("");
      setPrepressLineId("");
      setPrepressUnitId("");
      setNotice("");
    }
    sessionScopeRef.current = nextScope;
    setSessionScope(nextScope);
  }, [bootstrap.data?.sessionScope, queryClient]);
  const applyQuoteResult = (
    result: QuoteResult,
    resultOrganizationId: string,
    resultSessionScope: string,
  ) => {
    if (!resultSessionScope || sessionScopeRef.current !== resultSessionScope)
      return;
    const id = applyAuthoritativeQuoteResult(
      queryClient,
      resultSessionScope,
      resultOrganizationId,
      result,
    );
    void queryClient.invalidateQueries({
      queryKey: [
        "v2",
        resultSessionScope,
        resultOrganizationId,
        "sales",
        "quotes",
      ],
    });
    if (organizationRef.current === resultOrganizationId) {
      setQuoteId(id);
      setNewQuoteRequested(false);
    }
  };
  const reconcileAuthority = () =>
    reconcileForbiddenQuoteMutation(
      queryClient,
      sessionScope,
      organizationId,
      quoteId || undefined,
    );
  useEffect(() => {
    const resetForTrustedSessionChange = () => {
      clearV2SessionQueryState(queryClient);
      clearV2ApiSessionState();
      sessionScopeRef.current = "";
      setSessionScope("");
      setOrganizationId("");
      setQuoteId("");
      setNewQuoteRequested(false);
      setOrderId("");
      setCustomerId("");
      setContactId("");
      setProductId("");
      setProductBuilderId("");
      setNewProductBuilder(false);
      setInvoiceId("");
      setFulfillmentOrderId("");
      setProductionStation(undefined);
      setProductionWorkId("");
      setArtworkOrderId("");
      setArtworkLineId("");
      setProofWorkId("");
      setProofOrderId("");
      setProofLineId("");
      setPrepressLineId("");
      setPrepressUnitId("");
      setNotice("");
    };
    window.addEventListener(
      "v2:session-context-changed",
      resetForTrustedSessionChange,
    );
    return () =>
      window.removeEventListener(
        "v2:session-context-changed",
        resetForTrustedSessionChange,
      );
  }, [queryClient]);
  useEffect(() => {
    const applyBrowserLocation = () => {
      const redirect =
        legacyProductEditorRedirect() ??
        (window.location.pathname === "/product-builder"
          ? productPath()
          : null);
      if (redirect) window.history.replaceState({}, "", redirect);
      const location = readWorkspaceLocation();
      if (!location) return;
      setPage(location.page);
      setFormulaAuthoringContext(location.page === "formulas" ? readFormulaAuthoringContext() : null);
      if (location.page === "products") setProductId(location.productId ?? "");
      else if (location.page === "productBuilder") {
        setProductBuilderId(location.productId ?? "");
        setNewProductBuilder(location.newProduct === true);
      } else if (location.page === "customers")
        setCustomerId(location.customerId ?? "");
      else if (location.page === "contacts")
        setContactId(location.contactId ?? "");
      else if (location.page === "quotes") {
        setQuoteId(location.quoteId ?? "");
        setNewQuoteRequested(location.newQuote === true);
      }
      else if (location.page === "orders") setOrderId(location.orderId ?? "");
      else if (location.page === "invoices")
        setInvoiceId(location.invoiceId ?? "");
      else if (location.page === "fulfillment")
        setFulfillmentOrderId(location.orderId ?? "");
      else if (location.page === "production")
        {
          setProductionStation(location.station);
          setProductionWorkId(location.productionWorkId ?? "");
        }
      else if (location.page === "artwork") {
        setArtworkFileId(location.artworkFileId ?? "");
        setArtworkOrderId(location.orderId ?? "");
        setArtworkLineId(location.lineId ?? "");
      } else if (location.page === "proofing") {
        setProofWorkId(location.proofWorkId ?? "");
        setProofOrderId(location.orderId ?? "");
        setProofLineId(location.lineId ?? "");
      } else if (location.page === "prepress") {
        setPrepressLineId(location.lineId ?? "");
        setPrepressUnitId(location.prepressUnitId ?? "");
      }
    };
    applyBrowserLocation();
    window.addEventListener("popstate", applyBrowserLocation);
    return () => window.removeEventListener("popstate", applyBrowserLocation);
  }, []);
  useEffect(() => {
    const refreshTrustedBootstrap = () => {
      if (organizationRef.current)
        void queryClient.invalidateQueries({
          queryKey: quoteKeys.bootstrap(
            sessionScopeRef.current,
            organizationRef.current,
          ),
        });
    };
    window.addEventListener("focus", refreshTrustedBootstrap);
    return () => window.removeEventListener("focus", refreshTrustedBootstrap);
  }, [queryClient]);

  const navigate = (nextPage: V2VisualPage) => {
    if (nextPage === "home") window.history.pushState({}, "", "/");
    if (nextPage === "products") {
      pushProductLocation();
      setProductId("");
    }
    if (nextPage === "customers") {
      pushCustomerLocation();
      setCustomerId("");
    }
    if (nextPage === "contacts") {
      pushContactLocation();
      setContactId("");
    }
    if (nextPage === "quotes") {
      pushQuoteLocation();
      setQuoteId("");
      setNewQuoteRequested(false);
    }
    if (nextPage === "orders") {
      pushOrderLocation();
      setOrderId("");
    }
    if (nextPage === "invoices") {
      pushInvoiceLocation();
      setInvoiceId("");
    }
    if (nextPage === "fulfillment") {
      pushFulfillmentLocation();
      setFulfillmentOrderId("");
    }
    if (nextPage === "production") {
      pushProductionLocation();
      setProductionStation(undefined);
      setProductionWorkId("");
    }
    if (nextPage === "artwork") {
      setArtworkFileId("");
      setArtworkOrderId("");
      setArtworkLineId("");
    }
    if (
      nextPage === "routing" ||
      nextPage === "payments" ||
      nextPage === "artwork" ||
      nextPage === "proofing" ||
      nextPage === "prepress" ||
      nextPage === "formulas" || nextPage === "settings"
    )
      pushWorkspaceLocation(nextPage);
    setPage(nextPage);
    if (nextPage === "quotes") setOrderId("");
    if (nextPage === "orders") setQuoteId("");
  };
  return (
    <V2VisualShell
      page={page}
      onNavigate={navigate}
      appearance={appearance}
      setAppearance={setAppearance}
    >
      {page === "home" ? (
        <CommandCenter
          organizationId={organizationId}
          sessionScope={sessionScope}
          canQuoteView={
            bootstrap.data?.capabilities.quoteCreate === true ||
            bootstrap.data?.capabilities.quoteEdit === true
          }
          canOrderView={bootstrap.data?.capabilities.orderView === true}
          canFinanceView={bootstrap.data?.capabilities.invoiceView === true}
          navigate={navigate}
        />
      ) : page === "appearance" ? (
        <AppearanceWorkspace
          appearance={appearance}
          setAppearance={setAppearance}
        />
      ) : page === "settings" ? (
        <SettingsWorkspace salesTax={<SalesTaxSettingsWorkspace organizationId={organizationId} sessionScope={sessionScope} canConfigure={bootstrap.data?.capabilities.pricingConfigure === true} />} email={<EmailSettingsWorkspace organizationId={organizationId} sessionScope={sessionScope} canConfigure={bootstrap.data?.capabilities.communicationsConfigure === true} />} businessProfile={<OrganizationSettingsWorkspace organizationId={organizationId} sessionScope={sessionScope} canConfigure={bootstrap.data?.capabilities.organizationConfigure === true} section="business" />} documents={<OrganizationSettingsWorkspace organizationId={organizationId} sessionScope={sessionScope} canConfigure={bootstrap.data?.capabilities.organizationConfigure === true} section="documents" />} numbering={<NumberingSettingsWorkspace organizationId={organizationId} sessionScope={sessionScope} canConfigure={bootstrap.data?.capabilities.numberingConfigure === true} />} staff={<TeamAccessWorkspace organizationId={organizationId} sessionScope={sessionScope} canView={bootstrap.data?.capabilities.permissionsView === true} section="staff" />} permissionSets={<TeamAccessWorkspace organizationId={organizationId} sessionScope={sessionScope} canView={bootstrap.data?.capabilities.permissionsView === true} section="permission-sets" />} portalAccess={<TeamAccessWorkspace organizationId={organizationId} sessionScope={sessionScope} canView={bootstrap.data?.capabilities.permissionsView === true} section="portal" />} />
      ) : page === "formulas" ? (
        <FormulaLibraryWorkspace
          organizationId={organizationId}
          sessionScope={sessionScope}
          canEdit={bootstrap.data?.capabilities.pricingConfigure === true}
          authoringContext={formulaAuthoringContext ?? undefined}
          onReturnToProductBuilder={(selection) => {
            const context = formulaAuthoringContext;
            if (!context) return;
            window.history.pushState({}, "", productBuilderPath(context.productId, selection));
            setProductBuilderId(context.productId);
            setNewProductBuilder(false);
            setFormulaAuthoringContext(null);
            setPage("productBuilder");
          }}
        />
      ) : page === "customers" ? (
        <CustomerWorkspace
          organizationId={organizationId}
          sessionScope={sessionScope}
          customerId={customerId}
          canView={bootstrap.data?.capabilities.customerView === true}
          canCreate={bootstrap.data?.capabilities.customerEdit === true}
          openCustomer={(id) => {
            pushCustomerLocation(id);
            setCustomerId(id);
          }}
          backToCatalog={() => {
            pushCustomerLocation();
            setCustomerId("");
          }}
          openContact={(id) => {
            pushContactLocation(id);
            setContactId(id);
            setPage("contacts");
          }}
        />
      ) : page === "contacts" ? (
        <ContactsWorkspace
          organizationId={organizationId}
          sessionScope={sessionScope}
          contactId={contactId}
          canView={bootstrap.data?.capabilities.customerView === true}
          openContact={(id) => {
            pushContactLocation(id);
            setContactId(id);
          }}
          openCustomer={(id) => {
            pushCustomerLocation(id);
            setCustomerId(id);
            setPage("customers");
          }}
          backToCatalog={() => {
            pushContactLocation();
            setContactId("");
          }}
        />
      ) : page === "products" ? (
        <ProductWorkspace
          organizationId={organizationId}
          sessionScope={sessionScope}
          productId={productId}
          canView={bootstrap.data?.capabilities.productView === true}
          canEdit={bootstrap.data?.capabilities.productEdit === true}
          openEditor={(id) => {
            pushProductBuilderLocation(id);
            setProductBuilderId(id);
            setNewProductBuilder(false);
            setProductId("");
            setPage("productBuilder");
          }}
          openNewProduct={() => {
            pushNewProductBuilderLocation();
            setProductBuilderId("");
            setNewProductBuilder(true);
            setPage("productBuilder");
          }}
          backToCatalog={() => {
            pushProductLocation();
            setProductId("");
          }}
        />
      ) : page === "productBuilder" ? (
        <ProductWorkspace
          organizationId={organizationId}
          sessionScope={sessionScope}
          productId={productBuilderId}
          newProduct={newProductBuilder}
          canView={bootstrap.data?.capabilities.productView === true}
          canEdit={bootstrap.data?.capabilities.productEdit === true}
          builderMode
          openEditor={(id) => {
            pushProductBuilderLocation(id);
            setProductBuilderId(id);
            setNewProductBuilder(false);
          }}
          openCreatedProduct={(id) => {
            // The New Product Builder has already replaced /products/new with
            // the canonical Draft URL while preserving its local first-Save
            // state. This only synchronizes the application router once the
            // section writes have completed.
            setProductBuilderId(id);
            setNewProductBuilder(false);
          }}
          openNewProduct={() => {
            pushNewProductBuilderLocation();
            setProductBuilderId("");
            setNewProductBuilder(true);
          }}
          backToCatalog={() => {
            pushProductLocation();
            setProductBuilderId("");
            setProductId("");
            setNewProductBuilder(false);
            setPage("products");
          }}
        />
      ) : page === "routing" ? (
        <RoutingWorkspace
          organizationId={organizationId}
          sessionScope={sessionScope}
          canView={bootstrap.data?.capabilities.routeView === true}
          canAdvance={bootstrap.data?.capabilities.routeAdvance === true}
          openOrder={(id) => {
            pushOrderLocation(id);
            setOrderId(id);
            setPage("orders");
          }}
        />
      ) : page === "artwork" ? (
        <ArtworkWorkspace
          organizationId={organizationId}
          sessionScope={sessionScope}
          canView={bootstrap.data?.capabilities.artworkView === true}
          artworkFileId={artworkFileId || undefined}
          orderId={artworkOrderId || undefined}
          lineId={artworkLineId || undefined}
          openArtwork={(id) => {
            pushArtworkFileLocation(id);
            setArtworkFileId(id);
            setArtworkOrderId("");
            setArtworkLineId("");
          }}
          openCustomer={(id) => {
            pushCustomerLocation(id);
            setCustomerId(id);
            setPage("customers");
          }}
          openOrder={(id) => {
            pushOrderLocation(id);
            setOrderId(id);
            setPage("orders");
          }}
          backToCatalog={() => {
            pushArtworkLocation();
            setArtworkFileId("");
            setArtworkOrderId("");
            setArtworkLineId("");
          }}
        />
      ) : page === "proofing" ? (
        <ProofingWorkspace
          organizationId={organizationId}
          sessionScope={sessionScope}
          canView={bootstrap.data?.capabilities.proofView === true}
          canPrepare={bootstrap.data?.capabilities.proofPrepare === true}
          canIssue={bootstrap.data?.capabilities.proofIssue === true}
          canRespond={bootstrap.data?.capabilities.proofRespond === true}
          proofWorkId={proofWorkId || undefined}
          orderId={proofOrderId || undefined}
          lineId={proofLineId || undefined}
          openOrder={(id) => {
            pushOrderLocation(id);
            setOrderId(id);
            setPage("orders");
          }}
          openCustomer={(id) => {
            pushCustomerLocation(id);
            setCustomerId(id);
            setPage("customers");
          }}
          openArtwork={(id) => {
            pushArtworkFileLocation(id);
            setArtworkFileId(id);
            setArtworkOrderId("");
            setArtworkLineId("");
            setPage("artwork");
          }}
        />
      ) : page === "prepress" ? (
        <PrepressWorkspace
          organizationId={organizationId}
          sessionScope={sessionScope}
          canView={bootstrap.data?.capabilities.prepressView === true}
          canArtworkAssign={bootstrap.data?.capabilities.artworkAssign === true}
          canWork={bootstrap.data?.capabilities.prepressWork === true}
          canComplete={bootstrap.data?.capabilities.prepressComplete === true}
          lineId={prepressLineId || undefined}
          prepressUnitId={prepressUnitId || undefined}
          onSelectLine={(lineId) => {
            pushPrepressLocation(lineId);
            setPrepressLineId(lineId);
            setPrepressUnitId("");
          }}
          openOrder={(id) => {
            pushOrderLocation(id);
            setOrderId(id);
            setPage("orders");
          }}
          openCustomer={(id) => {
            pushCustomerLocation(id);
            setCustomerId(id);
            setPage("customers");
          }}
          openArtwork={(id) => {
            pushArtworkFileLocation(id);
            setArtworkFileId(id);
            setArtworkOrderId("");
            setArtworkLineId("");
            setPage("artwork");
          }}
        />
      ) : page === "production" ? (
        <ProductionWorkspace
          organizationId={organizationId}
          sessionScope={sessionScope}
          canView={bootstrap.data?.capabilities.productionView === true}
          canWork={bootstrap.data?.capabilities.productionWork === true}
          canComplete={bootstrap.data?.capabilities.productionComplete === true}
          station={productionStation}
          productionWorkId={productionWorkId || undefined}
          onStationChange={(station) => {
            pushProductionLocation(station);
            setProductionStation(station);
            setProductionWorkId("");
          }}
          onSelectWork={(id) => {
            if (id) pushProductionWorkLocation(id);
            else pushProductionLocation();
            setProductionWorkId(id ?? "");
          }}
          openOrder={(id) => {
            pushOrderLocation(id);
            setOrderId(id);
            setPage("orders");
          }}
          openCustomer={(id) => {
            pushCustomerLocation(id);
            setCustomerId(id);
            setPage("customers");
          }}
          openArtwork={(id) => {
            pushArtworkFileLocation(id);
            setArtworkFileId(id);
            setArtworkOrderId("");
            setArtworkLineId("");
            setPage("artwork");
          }}
        />
      ) : page === "fulfillment" ? (
        <FulfillmentWorkspace
          organizationId={organizationId}
          sessionScope={sessionScope}
          canView={bootstrap.data?.capabilities.fulfillmentView === true}
          canPickup={bootstrap.data?.capabilities.fulfillmentPickup === true}
          canShip={bootstrap.data?.capabilities.fulfillmentShip === true}
          csrfReady={Boolean(bootstrap)}
          orderId={fulfillmentOrderId}
          openOrder={(id) => {
            pushOrderLocation(id);
            setOrderId(id);
            setPage("orders");
          }}
          openCustomer={(id) => {
            pushCustomerLocation(id);
            setCustomerId(id);
            setPage("customers");
          }}
          onSelectOrder={(id) => {
            pushFulfillmentLocation(id);
            setFulfillmentOrderId(id);
          }}
        />
      ) : page === "invoices" || page === "payments" ? (
        <FinanceWorkspace
          mode={page === "payments" ? "ledger" : "invoices"}
          organizationId={organizationId}
          sessionScope={sessionScope}
          invoiceId={invoiceId}
          onSelectInvoice={(id) => {
            pushInvoiceLocation(id);
            setInvoiceId(id);
          }}
          backToInvoices={() => {
            pushInvoiceLocation();
            setInvoiceId("");
          }}
          canIssue={bootstrap.data?.capabilities.invoiceIssue === true}
          canInvoiceView={bootstrap.data?.capabilities.invoiceView === true}
          canPaymentView={bootstrap.data?.capabilities.paymentView === true}
          canPaymentRecord={bootstrap.data?.capabilities.paymentRecord === true}
          canRefundIssue={bootstrap.data?.capabilities.refundIssue === true}
          csrfReady={Boolean(bootstrap)}
          openOrder={(id) => {
            pushOrderLocation(id);
            setOrderId(id);
          }}
          openCustomer={(id) => {
            pushCustomerLocation(id);
            setCustomerId(id);
            setPage("customers");
          }}
        />
      ) : (
        <>
          {page === "orders" ? (
            <OrdersPage
              organizationId={organizationId}
              setOrganizationId={(next) => {
                setOrganizationId(next);
                setOrderId("");
              }}
              sessionScope={sessionScope}
              orderId={orderId}
              setOrderId={(id) => {
                pushOrderLocation(id || undefined);
                setOrderId(id);
              }}
              bootstrap={bootstrap.data}
              openCustomer={(id) => {
                pushCustomerLocation(id);
                setCustomerId(id);
                setPage("customers");
              }}
              openFulfillment={(id) => {
                pushFulfillmentLocation(id);
                setFulfillmentOrderId(id);
                setPage("fulfillment");
              }}
              openInvoice={(id) => {
                pushInvoiceLocation(id);
                setInvoiceId(id);
                setPage("invoices");
              }}
              openArtwork={(id, lineId) => {
                pushArtworkLocation(id, lineId);
                setArtworkOrderId(id);
                setArtworkLineId(lineId ?? "");
                setPage("artwork");
              }}
              openProofing={(orderId, lineId) => {
                pushProofingLocation(undefined, orderId, lineId);
                setProofWorkId("");
                setProofOrderId(orderId);
                setProofLineId(lineId);
                setPage("proofing");
              }}
              openProduction={(id) => {
                pushProductionWorkLocation(id);
                setProductionWorkId(id);
                setPage("production");
              }}
              openRouting={() => {
                pushWorkspaceLocation("routing");
                setPage("routing");
              }}
              openQuote={(id) => {
                pushQuoteLocation(id);
                setQuoteId(id);
                setNewQuoteRequested(false);
                setPage("quotes");
              }}
            />
          ) : (
            <QuotesPage
              organizationId={organizationId}
              setOrganizationId={(nextOrganizationId) => {
                setOrganizationId(nextOrganizationId);
                setQuoteId("");
              }}
              sessionScope={sessionScope}
              quoteId={quoteId}
              newQuoteRequested={newQuoteRequested}
              setQuoteId={(id) => {
                pushQuoteLocation(id || undefined);
                setQuoteId(id);
                setNewQuoteRequested(false);
              }}
              quote={quote.data}
              error={quote.error ?? bootstrap.error}
              loading={quote.isFetching}
              load={(id) => {
                pushQuoteLocation(id);
                setQuoteId(id);
                setNewQuoteRequested(false);
                setNotice("");
              }}
              reload={() =>
                queryClient.invalidateQueries({
                  queryKey: quoteKeys.quote(
                    sessionScope,
                    organizationId,
                    quoteId,
                  ),
                })
              }
              notice={notice}
              setNotice={setNotice}
              applyQuoteResult={applyQuoteResult}
              reconcileAuthority={reconcileAuthority}
              canOverridePrice={
                bootstrap.data?.capabilities.quoteOverridePrice === true
              }
              canCreate={bootstrap.data?.capabilities.quoteCreate === true}
              canEdit={bootstrap.data?.capabilities.quoteEdit === true}
              canSend={bootstrap.data?.capabilities.quoteSend === true}
              canConvert={bootstrap.data?.capabilities.quoteConvert === true}
              csrfReady={bootstrap.isSuccess}
              openOrder={(id) => {
                pushOrderLocation(id);
                setOrderId(id);
                setPage("orders");
              }}
              openCustomer={(id) => {
                pushCustomerLocation(id);
                setCustomerId(id);
                setPage("customers");
              }}
            />
          )}
        </>
      )}
    </V2VisualShell>
  );
};

const Lab = () => (
  <section className="lab">
    <div className="card">
      <h2>Controls</h2>
      <div className="lab-row">
        <button className="button">Primary action</button>
        <button className="button secondary">Secondary</button>
        <button className="button danger">Destructive</button>
        <button className="button" disabled>
          Disabled
        </button>
        <input aria-label="Sample input" placeholder="Input" />
        <select aria-label="Sample select">
          <option>Selection</option>
        </select>
      </div>
    </div>
    <div className="card">
      <h2>Status and states</h2>
      <div className="lab-row">
        <Status value="sent" />
        <Status value="accepted" />
        <span className="badge">Informational</span>
        <span className="notice">Warning state</span>
        <span className="notice error">Validation error</span>
      </div>
    </div>
  </section>
);

const SalesList = ({
  kind,
  items,
  onOpen,
  organizationId,
}: Readonly<{
  kind: "Quote" | "Order";
  items: readonly Readonly<{
    source: "v2" | "legacy";
    recordId: string;
    number: string;
    customerDisplayName: string;
    lifecycle: string;
    sellingTotalCents: number;
    currency: string;
    requestedDueDate?: string;
    updatedAt: string;
    quoteId?: string;
    orderId?: string;
    draftInvoice?: unknown;
    routing?: string;
    activeRecordClassification?: string;
  }>[];
  onOpen: (id: string) => void;
  organizationId: string;
}>) => {
  const [legacy, setLegacy] = useState<Readonly<{ recordId: string }> | null>(
    null,
  );
  const detail = useQuery({
    queryKey: ["v2", "legacy", kind, organizationId, legacy?.recordId],
    queryFn: () =>
      kind === "Quote"
        ? quoteApi.legacy(organizationId, legacy!.recordId)
        : orderApi.legacy(organizationId, legacy!.recordId),
    enabled: Boolean(legacy?.recordId && organizationId),
  });
  return (
    <div className="card">
      <h2>{kind}s</h2>
      {items.length === 0 ? (
        <p className="muted">
          No {kind.toLowerCase()}s match this organization and filter.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Number</th>
              <th>Source</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Due date</th>
              <th>Total</th>
              <th>Updated</th>
              {kind === "Order" && (
                <>
                  <th>Invoice</th>
                  <th>Routing</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={`${item.source}:${item.recordId}`}
                onClick={() =>
                  item.source === "legacy"
                    ? setLegacy({ recordId: item.recordId })
                    : onOpen(item.quoteId ?? item.orderId ?? "")
                }
                className="clickable-row"
              >
                <td>
                  <button className="link-button">{item.number}</button>
                </td>
                <td>
                  <span className="badge">
                    {item.source === "legacy" ? "Legacy (read-only)" : "V2"}
                  </span>
                </td>
                <td>{item.customerDisplayName}</td>
                <td>
                  <LifecycleBadge value={item.lifecycle} />
                  {item.activeRecordClassification && (
                    <small> {item.activeRecordClassification}</small>
                  )}
                </td>
                <td>{item.requestedDueDate ?? "—"}</td>
                <td>
                  {money({
                    cents: item.sellingTotalCents,
                    currency: item.currency,
                  })}
                </td>
                <td>{new Date(item.updatedAt).toLocaleString()}</td>
                {kind === "Order" && (
                  <>
                    <td>{item.draftInvoice ? "Draft" : "—"}</td>
                    <td>{item.routing === "routed" ? "Routed" : "No route"}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {legacy && (
        <section className="card">
          <button className="link-button" onClick={() => setLegacy(null)}>
            Close legacy record
          </button>
          {detail.isLoading ? (
            <p>Loading read-only legacy record…</p>
          ) : detail.data ? (
            <>
              <h3>
                {detail.data.number}{" "}
                <span className="badge">Legacy (read-only)</span>
              </h3>
              <p>
                {detail.data.customerDisplayName} · {detail.data.lifecycle}
              </p>
              <p>
                {money({
                  cents: detail.data.sellingTotalCents,
                  currency: detail.data.currency,
                })}
              </p>
              {detail.data.activeRecordClassification && (
                <p>
                  Cutover assessment: {detail.data.activeRecordClassification}
                </p>
              )}
              <p className="muted">
                Legacy records are visible for history and cannot be edited,
                converted, invoiced, paid, or routed from V2.
              </p>
            </>
          ) : (
            <p className="notice error">Unable to open the legacy record.</p>
          )}
        </section>
      )}
    </div>
  );
};

const SalesPagination = ({
  cursor,
  nextCursor,
  setCursor,
}: Readonly<{
  cursor: string;
  nextCursor?: string;
  setCursor: (value: string) => void;
}>) => (
  <div className="actions list-pagination">
    {cursor && (
      <button className="button secondary" onClick={() => setCursor("")}>
        First page
      </button>
    )}
    {nextCursor && (
      <button
        className="button secondary"
        onClick={() => setCursor(nextCursor)}
      >
        Next page
      </button>
    )}
  </div>
);

const LegacyQuoteWorkspace = ({
  organizationId,
  sessionScope,
  recordId,
  onBack,
}: Readonly<{
  organizationId: string;
  sessionScope: string;
  recordId: string;
  onBack: () => void;
}>) => {
  const legacy = useQuery({
    queryKey: ["v2", sessionScope, organizationId, "legacy-quote", recordId],
    queryFn: () => quoteApi.legacy(organizationId, recordId),
    enabled: Boolean(sessionScope && organizationId && recordId),
  });
  if (legacy.isLoading)
    return (
      <section className="v2-sales-workspace">
        <p className="v2-sales-loading">Loading read-only legacy quote…</p>
      </section>
    );
  if (!legacy.data)
    return (
      <section className="v2-sales-workspace">
        <button className="v2-sales-back" type="button" onClick={onBack}>
          ← Quotes
        </button>
        <p className="notice error">Unable to open the legacy Quote.</p>
      </section>
    );
  const detail: LegacyCommercialDetail = legacy.data;
  const unavailable = "Unavailable in the legacy projection";
  const items = (
    <SalesDocumentSplit
      left={
        <section className="v2-sales-items">
          <header>
            <div>
              <h2>Items</h2>
              <p>Legacy line detail was not migrated into this V2 workspace.</p>
            </div>
          </header>
          <div className="v2-sales-items-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Configuration</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={5} className="v2-sales-empty-cell">
                    No line details are available from the legacy read model.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <footer>
            <span>Known legacy total</span>
            <strong>
              {money({
                cents: detail.sellingTotalCents,
                currency: detail.currency,
              })}
            </strong>
          </footer>
        </section>
      }
      right={
        <SalesDocumentEmpty>
          Selecting or changing a legacy line is unavailable. Legacy records
          remain history-only in V2.
        </SalesDocumentEmpty>
      }
    />
  );
  return (
    <section className="v2-sales-workspace">
      <button className="v2-sales-back" type="button" onClick={onBack}>
        ← Quotes
      </button>
      <SalesDocumentFrame
        documentType="Quote"
        number={detail.number}
        readOnly
        status={<LifecycleBadge value={detail.lifecycle} />}
        metadata={
          <dl className="v2-sales-meta-grid">
            <div>
              <dt>Customer</dt>
              <dd>{detail.customerDisplayName}</dd>
            </div>
            <div>
              <dt>Contact</dt>
              <dd>{unavailable}</dd>
            </div>
            <div>
              <dt>PO</dt>
              <dd>{unavailable}</dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd>{detail.requestedDueDate ?? unavailable}</dd>
            </div>
            <div>
              <dt>Sales rep</dt>
              <dd>{unavailable}</dd>
            </div>
            <div>
              <dt>Terms</dt>
              <dd>{unavailable}</dd>
            </div>
          </dl>
        }
        panels={{
          Items: items,
          Artwork: (
            <SalesDocumentEmpty>
              No artwork records are available from this legacy projection.
            </SalesDocumentEmpty>
          ),
          Notes: (
            <SalesDocumentEmpty>
              No notes are available from this legacy projection.
            </SalesDocumentEmpty>
          ),
          History: (
            <SalesDocumentEmpty>
              Legacy record last updated{" "}
              {new Date(detail.updatedAt).toLocaleString()}.
            </SalesDocumentEmpty>
          ),
        }}
      />
    </section>
  );
};

const LegacyOrderWorkspace = ({
  organizationId,
  sessionScope,
  recordId,
  onBack,
}: Readonly<{
  organizationId: string;
  sessionScope: string;
  recordId: string;
  onBack: () => void;
}>) => {
  const legacy = useQuery({
    queryKey: ["v2", sessionScope, organizationId, "legacy-order", recordId],
    queryFn: () => orderApi.legacy(organizationId, recordId),
    enabled: Boolean(sessionScope && organizationId && recordId),
  });
  if (legacy.isLoading)
    return (
      <section className="v2-sales-workspace">
        <p className="v2-sales-loading">Loading Order…</p>
      </section>
    );
  if (!legacy.data)
    return (
      <section className="v2-sales-workspace">
        <p className="notice error">Unable to open the Order.</p>
      </section>
    );
  const detail = legacy.data;
  return (
    <section className="lab v2-sales-workspace">
      <button className="v2-sales-back" type="button" onClick={onBack}>
        ← Orders
      </button>
      <SalesDocumentFrame
        documentType="Order"
        number={detail.number}
        readOnly
        readOnlyLabel="Legacy · read only"
        status={<LifecycleBadge value={detail.lifecycle} />}
        metadata={
          <dl className="v2-sales-meta-grid">
            <div>
              <dt>Customer</dt>
              <dd>{detail.customerDisplayName}</dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd>{detail.requestedDueDate ?? "Unavailable"}</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>
                {money({
                  cents: detail.sellingTotalCents,
                  currency: detail.currency,
                })}
              </dd>
            </div>
          </dl>
        }
        panels={{
          Items: (
            <SalesDocumentEmpty>
              Line detail is unavailable for this legacy Order.
            </SalesDocumentEmpty>
          ),
          Artwork: (
            <SalesDocumentEmpty>
              No artwork records are available.
            </SalesDocumentEmpty>
          ),
          Notes: (
            <SalesDocumentEmpty>No notes are available.</SalesDocumentEmpty>
          ),
          Billing: (
            <SalesDocumentEmpty>
              Billing details are unavailable for this legacy Order.
            </SalesDocumentEmpty>
          ),
          Fulfillment: (
            <SalesDocumentEmpty>
              Fulfillment details are unavailable for this legacy Order.
            </SalesDocumentEmpty>
          ),
          History: (
            <SalesDocumentEmpty>Legacy Order · read only</SalesDocumentEmpty>
          ),
        }}
      />
    </section>
  );
};

const QuotesPage = (
  props: WorkspaceProps &
    Readonly<{
      quoteId: string;
      newQuoteRequested: boolean;
      setQuoteId: (value: string) => void;
      canCreate: boolean;
      canEdit: boolean;
      canSend: boolean;
      canConvert: boolean;
      openOrder: (value: string) => void;
    }>,
) => {
  const [creating, setCreating] = useState(() => {
    try {
      const requested = sessionStorage.getItem("ph.v2.new-quote") === "1";
      if (requested) sessionStorage.removeItem("ph.v2.new-quote");
      return requested;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const open = () => setCreating(true);
    window.addEventListener("v2:new-quote", open);
    return () => window.removeEventListener("v2:new-quote", open);
  }, []);
  const [legacyQuoteId, setLegacyQuoteId] = useState("");
  const mode = quoteRouteMode({
    quoteId: props.quoteId,
    createRequested: creating || props.newQuoteRequested,
    hasQuote: Boolean(props.quote),
    hasError: Boolean(props.error),
  });
  if (legacyQuoteId)
    return (
      <LegacyQuoteWorkspace
        organizationId={props.organizationId}
        sessionScope={props.sessionScope}
        recordId={legacyQuoteId}
        onBack={() => setLegacyQuoteId("")}
      />
    );
  if (mode === "create")
    return (
      <SalesEntryWorkspace
        mode="quote"
        organizationId={props.organizationId}
        sessionScope={props.sessionScope}
        canCreate={props.canCreate}
        canOverridePrice={props.canOverridePrice}
        csrfReady={props.csrfReady}
        onCancel={() => {
          setCreating(false);
          if (props.newQuoteRequested) props.setQuoteId("");
        }}
        onQuoteCreated={(result) => {
          props.applyQuoteResult(
            result,
            props.organizationId,
            props.sessionScope,
          );
          props.load(result.quote.quote.quoteId);
          setCreating(false);
        }}
      />
    );
  if (mode === "loading-existing") {
    return (
      <section className="lab v2-sales-workspace v2-quote-editor" aria-busy="true">
        <SalesDocumentEmpty>Loading Quote…</SalesDocumentEmpty>
      </section>
    );
  }
  if (mode === "unavailable") {
    return (
      <section className="lab v2-sales-workspace v2-quote-editor">
        <SalesDocumentEmpty>
          <h2>Quote unavailable</h2>
          <p>{errorText(props.error)}</p>
          <button className="button secondary" type="button" onClick={props.reload}>
            Retry
          </button>
        </SalesDocumentEmpty>
      </section>
    );
  }
  if (mode === "existing") {
    return (
      <section className="lab v2-sales-workspace v2-quote-editor">
        <button
          className="link-button"
          onClick={() => {
            setCreating(false);
            props.setQuoteId("");
          }}
        >
          ← Quotes
        </button>
        <QuoteWorkspace {...props} />
      </section>
    );
  }
  return (
    <QuotesList
      organizationId={props.organizationId}
      sessionScope={props.sessionScope}
      canCreate={props.canCreate}
      onCreate={() => {
        pushNewQuoteLocation();
        setCreating(true);
      }}
      onOpenV2={props.setQuoteId}
      onOpenLegacy={setLegacyQuoteId}
    />
  );
};

const OrdersPage = ({
  organizationId,
  sessionScope,
  orderId,
  setOrderId,
  bootstrap,
  openCustomer,
  openFulfillment,
  openInvoice,
  openArtwork,
  openProofing,
  openProduction,
  openRouting,
  openQuote,
}: Readonly<{
  organizationId: string;
  setOrganizationId: (value: string) => void;
  sessionScope: string;
  orderId: string;
  setOrderId: (value: string) => void;
  bootstrap?: import("./api").UiBootstrap;
  openCustomer: (customerId: string) => void;
  openFulfillment: (orderId: string) => void;
  openInvoice: (invoiceId: string) => void;
  openArtwork: (orderId: string, lineId: string) => void;
  openProofing: (orderId: string, lineId: string) => void;
  openProduction: (productionWorkId: string) => void;
  openRouting: () => void;
  openQuote: (quoteId: string) => void;
}>) => {
  const [legacyOrderId, setLegacyOrderId] = useState("");
  if (orderId)
    return (
      <OrderWorkspace
        organizationId={organizationId}
        sessionScope={sessionScope}
        orderId={orderId}
        canEdit={bootstrap?.capabilities.orderEdit === true}
        canCreate={bootstrap?.capabilities.orderCreate === true}
        canCancel={bootstrap?.capabilities.orderCancel === true}
        canOverridePrice={bootstrap?.capabilities.orderOverridePrice === true}
        canViewInvoice={bootstrap?.capabilities.invoiceView === true}
        canViewArtwork={bootstrap?.capabilities.artworkView === true}
        canViewProofing={bootstrap?.capabilities.proofView === true}
        canViewProduction={bootstrap?.capabilities.productionView === true}
        csrfReady={Boolean(bootstrap)}
        onBack={() => setOrderId("")}
        openOrder={(id) => setOrderId(id)}
        openCustomer={openCustomer}
        openFulfillment={openFulfillment}
        openInvoice={openInvoice}
        openArtwork={openArtwork}
        openProofing={openProofing}
        openProduction={openProduction}
        openRouting={bootstrap?.capabilities.routeView === true ? openRouting : undefined}
        openQuote={openQuote}
      />
    );
  if (legacyOrderId)
    return (
      <LegacyOrderWorkspace
        organizationId={organizationId}
        sessionScope={sessionScope}
        recordId={legacyOrderId}
        onBack={() => setLegacyOrderId("")}
      />
    );
  return (
    <OrdersList
      organizationId={organizationId}
      sessionScope={sessionScope}
      onOpenV2={setOrderId}
      onOpenLegacy={setLegacyOrderId}
    />
  );
};

type WorkspaceProps = Readonly<{
  organizationId: string;
  setOrganizationId: (value: string) => void;
  sessionScope: string;
  quote?: QuoteRead;
  error: unknown;
  loading: boolean;
  load: (quoteId: string) => void;
  reload: () => void;
  notice: string;
  setNotice: (value: string) => void;
  applyQuoteResult: (
    result: QuoteResult,
    organizationId: string,
    sessionScope: string,
  ) => void;
  reconcileAuthority: () => Promise<void>;
  canOverridePrice: boolean;
  canCreate?: boolean;
  canEdit?: boolean;
  canSend?: boolean;
  canConvert?: boolean;
  csrfReady: boolean;
  openOrder?: (orderId: string) => void;
  openCustomer?: (customerId: string) => void;
}>;

const lineConfiguration = (line: SalesLine): string => orderConfigurationPresentation(line.resolvedConfiguration);

const QuoteDocumentMetadata = ({
  customerId,
  contactId,
  customers,
  contacts,
  purchaseOrderNumber,
  requestedDueDate,
  expiresAt,
  termsCode,
  canEdit = true,
  readOnly = false,
  onCustomerChange,
  onContactChange,
  onPurchaseOrderChange,
  onDueDateChange,
  onExpiresAtChange,
  onTermsCodeChange,
}: Readonly<{
  customerId: string;
  contactId: string;
  customers: readonly Selection[];
  contacts: readonly Selection[];
  purchaseOrderNumber: string;
  requestedDueDate: string;
  expiresAt: string;
  termsCode: string;
  canEdit?: boolean;
  readOnly?: boolean;
  onCustomerChange?: (value: string) => void;
  onContactChange?: (value: string) => void;
  onPurchaseOrderChange?: (value: string) => void;
  onDueDateChange?: (value: string) => void;
  onExpiresAtChange?: (value: string) => void;
  onTermsCodeChange?: (value: string) => void;
}>) => {
  const customerName =
    customers.find((customer) => customer.customerId === customerId)
      ?.displayName ?? "Unavailable";
  const contactName =
    contacts.find((contact) => contact.contactId === contactId)?.displayName ??
    "Unavailable";
  return (
    <div className="v2-sales-compact-meta">
      <div className="v2-sales-identity">
        {readOnly ? (
          <strong>{customerName}</strong>
        ) : (
          <select
            className="v2-sales-customer-select"
            aria-label="Customer"
            value={customerId}
            disabled={!canEdit}
            onChange={(event) => onCustomerChange?.(event.target.value)}
          >
            <option value="">Select Customer</option>
            {customers.map((customer) =>
              customer.customerId ? (
                <option key={customer.customerId} value={customer.customerId}>
                  {customer.displayName}
                </option>
              ) : null,
            )}
          </select>
        )}
        <label className="v2-sales-contact-select">
          <small>Contact</small>
          {readOnly ? (
            <span>{contactId ? contactName : "Unavailable"}</span>
          ) : (
            <select
              aria-label="Contact"
              value={contactId}
              disabled={!customerId || !canEdit}
              onChange={(event) => onContactChange?.(event.target.value)}
            >
              <option value="">Select Contact</option>
              {contacts.map((contact) =>
                contact.contactId ? (
                  <option key={contact.contactId} value={contact.contactId}>
                    {contact.displayName}
                  </option>
                ) : null,
              )}
            </select>
          )}
        </label>
      </div>
      <label className="v2-sales-inline-fact">
        <small>PO #</small>
        {readOnly ? (
          <span>{purchaseOrderNumber || "Unavailable"}</span>
        ) : (
          <input
            aria-label="PO #"
            value={purchaseOrderNumber}
            disabled={!canEdit}
            onChange={(event) => onPurchaseOrderChange?.(event.target.value)}
          />
        )}
      </label>
      <label className="v2-sales-inline-fact">
        <small>Quote expiry</small>
        {readOnly ? <span>{expiresAt || "No expiry"}</span> : <input aria-label="Quote expiry" type="date" value={expiresAt} disabled={!canEdit} onChange={(event) => onExpiresAtChange?.(event.target.value)} />}
      </label>
      <label className="v2-sales-inline-fact">
        <small>Requested Due</small>
        {readOnly ? (
          <span>{requestedDueDate || "Unavailable"}</span>
        ) : (
          <input
            aria-label="Requested Due"
            type="date"
            value={requestedDueDate}
            disabled={!canEdit}
            onInput={(event) => onDueDateChange?.(event.currentTarget.value)}
            onChange={(event) => onDueDateChange?.(event.target.value)}
          />
        )}
      </label>
      <div className="v2-sales-inline-fact">
        <small>Sales Rep</small>
        <span>Unavailable</span>
      </div>
      <div className="v2-sales-inline-fact">
        <small>Terms</small>
        {readOnly ? <span>{termsCode || "Not set"}</span> : <input aria-label="Terms" value={termsCode} disabled={!canEdit} onChange={(event) => onTermsCodeChange?.(event.target.value)} />}
      </div>
      <div className="v2-sales-inline-fact">
        <small>Fulfillment</small>
        <span>Unavailable</span>
      </div>
      <div className="v2-sales-inline-fact">
        <small>Job Name</small>
        <span>Unavailable</span>
      </div>
    </div>
  );
};

const QuoteWorkspace = ({
  organizationId,
  setOrganizationId,
  sessionScope,
  quote,
  error,
  loading,
  load,
  reload,
  notice,
  setNotice,
  applyQuoteResult,
  reconcileAuthority,
  canOverridePrice,
  canCreate = false,
  canEdit = true,
  canSend = true,
  canConvert = false,
  csrfReady,
  openOrder,
  openCustomer,
}: WorkspaceProps) => {
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState("");
  const [contactId, setContactId] = useState("");
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState("");
  const [requestedDueDate, setRequestedDueDate] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [termsCode, setTermsCode] = useState("");
  const [commercialNotes, setCommercialNotes] = useState("");
  const [fulfillmentMethod, setFulfillmentMethod] = useState<"pickup" | "shipping" | "local_delivery">("pickup");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [destinationCity, setDestinationCity] = useState("");
  const [destinationRegion, setDestinationRegion] = useState("");
  const [destinationCountry, setDestinationCountry] = useState("US");
  const [destinationPostalCode, setDestinationPostalCode] = useState("");
  const [fulfillmentInstructions, setFulfillmentInstructions] = useState("");
  const [adjustmentCents, setAdjustmentCents] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [chargeKind, setChargeKind] = useState<"shipping" | "delivery" | "handling" | "packing" | "crating" | "postage">("shipping");
  const [chargeCents, setChargeCents] = useState("");
  const [chargeDescription, setChargeDescription] = useState("");
  const [headerCustomerId, setHeaderCustomerId] = useState("");
  const [headerContactId, setHeaderContactId] = useState("");
  const [editingLineId, setEditingLineId] = useState("");
  const [addEditorVersion, setAddEditorVersion] = useState(0);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [acceptDialogOpen, setAcceptDialogOpen] = useState(false);
  const customers = useQuoteFormCustomers(sessionScope, organizationId);
  const contacts = useQuoteFormContacts(
    sessionScope,
    organizationId,
    quote ? headerCustomerId : customerId,
  );
  const products = useQuoteFormProducts(sessionScope, organizationId);
  const recipientContact = useQuery({
    queryKey: [
      "v2",
      sessionScope,
      organizationId,
      "quote-send-contact",
      quote?.quote.customerContact.contactId ?? "",
    ],
    queryFn: () =>
      contactApi.get(organizationId, quote!.quote.customerContact.contactId!),
    enabled: Boolean(
      (sendDialogOpen || acceptDialogOpen) &&
      sessionScope &&
      organizationId &&
      quote?.quote.customerContact.contactId,
    ),
  });
  const sendReadiness = useQuery<QuoteSendReadiness>({
    queryKey: ["v2", sessionScope, organizationId, "quote-send-readiness", quote?.quote.quoteId ?? ""],
    queryFn: () => quoteApi.sendReadiness(organizationId, quote!.quote.quoteId),
    enabled: Boolean(sendDialogOpen && sessionScope && organizationId && quote?.quote.quoteId),
  });
  const sendReadinessError = sendReadiness.error as unknown as ApiError | null;
  const requestIds = useRef<Record<string, { id: string; payload: string }>>(
    {},
  );

  const requestId = (operation: string, payload: unknown) => {
    const serialized = JSON.stringify(payload);
    const existing = requestIds.current[operation];
    if (!existing || existing.payload !== serialized)
      requestIds.current[operation] = {
        id: newBusinessRequestId(),
        payload: serialized,
      };
    return requestIds.current[operation]!.id;
  };
  const completeRequest = (operation: string) => {
    delete requestIds.current[operation];
  };

  useEffect(() => {
    setPurchaseOrderNumber(quote?.quote.purchaseOrderNumber ?? "");
    setRequestedDueDate(dateInputValue(quote?.quote.requestedDueDate));
    setExpiresAt(dateInputValue(quote?.quote.expiresAt));
    setTermsCode(quote?.quote.terms.termsCode ?? "");
    setCommercialNotes(quote?.quote.terms.commercialNotes ?? "");
    setFulfillmentMethod(quote?.quote.requestedFulfillment?.method ?? "pickup");
    setDestinationAddress(quote?.quote.requestedFulfillment?.destination?.addressLine1 ?? "");
    setDestinationCity(quote?.quote.requestedFulfillment?.destination?.city ?? "");
    setDestinationRegion(quote?.quote.requestedFulfillment?.destination?.region ?? "");
    setDestinationCountry(quote?.quote.requestedFulfillment?.destination?.country ?? "US");
    setDestinationPostalCode(quote?.quote.requestedFulfillment?.destination?.postalCode ?? "");
    setFulfillmentInstructions(quote?.quote.requestedFulfillment?.instructions ?? "");
    setAdjustmentCents(quote?.quote.sellingAdjustment ? String(quote.quote.sellingAdjustment.cents) : "");
    setAdjustmentReason(quote?.quote.sellingAdjustment?.reason ?? "");
    setChargeKind(quote?.quote.commercialCharge?.kind ?? "shipping");
    setChargeCents(quote?.quote.commercialCharge ? String(quote.quote.commercialCharge.cents) : "");
    setChargeDescription(quote?.quote.commercialCharge?.description ?? "");
    setHeaderCustomerId(quote?.quote.customerContact.customerId ?? "");
    setHeaderContactId(quote?.quote.customerContact.contactId ?? "");
    setEditingLineId("");
  }, [quote?.quote.quoteId]);

  const handleMutationError = (mutationError: unknown) => {
    const code = (mutationError as ApiError)?.code;
    if (code === "FORBIDDEN") void reconcileAuthority();
    if (code === "STALE_STATE") {
      setNotice(
        "This Quote changed elsewhere. Current server state is refreshing; review your retained draft before resubmitting.",
      );
      void reload();
    }
  };

  const create = useMutation({
    mutationFn: (line: QuoteLineMutationInput) => {
      const payload = {
        organizationId,
        customerId,
        contactId,
        purchaseOrderNumber,
        requestedDueDate,
        commercialNotes,
        line,
        fulfillmentMethod, destinationAddress, destinationCity, destinationRegion, destinationCountry, destinationPostalCode, fulfillmentInstructions, adjustmentCents, adjustmentReason, chargeKind, chargeCents, chargeDescription,
      };
      return quoteApi.create(organizationId, requestId("create", payload), {
        customerContact: {
          organizationId,
          customerId,
          ...(contactId ? { contactId } : {}),
        },
        ...(purchaseOrderNumber.trim()
          ? { purchaseOrderNumber: purchaseOrderNumber.trim() }
          : {}),
        ...(requestedDueDate ? { requestedDueDate } : {}),
        ...(commercialNotes.trim() || termsCode.trim()
          ? { terms: { ...(termsCode.trim() ? { termsCode: termsCode.trim() } : {}), commercialNotes: commercialNotes.trim() } }
          : {}),
        ...(expiresAt ? { expiresAt } : {}),
        requestedFulfillment: fulfillmentMethod === "pickup" ? { method: "pickup", ...(fulfillmentInstructions.trim() ? { instructions: fulfillmentInstructions.trim() } : {}) } : { method: fulfillmentMethod, destination: { addressLine1: destinationAddress, city: destinationCity, region: destinationRegion, country: destinationCountry, ...(destinationPostalCode ? { postalCode: destinationPostalCode } : {}) }, ...(fulfillmentInstructions.trim() ? { instructions: fulfillmentInstructions.trim() } : {}) },
        ...(adjustmentCents.trim() ? { sellingAdjustment: { cents: Number(adjustmentCents), reason: adjustmentReason } } : {}),
        ...(chargeCents.trim() ? { commercialCharge: { kind: chargeKind, cents: Number(chargeCents), ...(chargeDescription.trim() ? { description: chargeDescription } : {}) } } : {}),
        lines: [line],
      });
    },
    onSuccess: (result) => {
      completeRequest("create");
      applyQuoteResult(result, organizationId, sessionScope);
      load(result.quote.quote.quoteId);
      setNotice("Quote created.");
    },
    onError: handleMutationError,
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        organizationId,
        quoteId: quote!.quote.quoteId,
        revision: quote!.revision,
        purchaseOrderNumber,
        requestedDueDate,
        expiresAt,
        termsCode,
        commercialNotes,
        headerCustomerId,
        headerContactId,
        fulfillmentMethod, destinationAddress, destinationCity, destinationRegion, destinationCountry, destinationPostalCode, fulfillmentInstructions, adjustmentCents, adjustmentReason, chargeKind, chargeCents, chargeDescription,
      };
      return quoteApi.patch(
        organizationId,
        quote!.quote.quoteId,
        requestId("save", payload),
        {
          expectedRevision: quote!.revision,
          patch: {
            customerContact: {
              organizationId,
              customerId: headerCustomerId,
              ...(headerContactId ? { contactId: headerContactId } : {}),
            },
            purchaseOrderNumber: purchaseOrderNumber.trim() || null,
            requestedDueDate: requestedDueDate || null,
            terms: { ...(termsCode.trim() ? { termsCode: termsCode.trim() } : {}), commercialNotes },
            expiresAt: expiresAt || null,
            requestedFulfillment: fulfillmentMethod === "pickup" ? { method: "pickup", ...(fulfillmentInstructions.trim() ? { instructions: fulfillmentInstructions.trim() } : {}) } : { method: fulfillmentMethod, destination: { addressLine1: destinationAddress, city: destinationCity, region: destinationRegion, country: destinationCountry, ...(destinationPostalCode ? { postalCode: destinationPostalCode } : {}) }, ...(fulfillmentInstructions.trim() ? { instructions: fulfillmentInstructions.trim() } : {}) },
            sellingAdjustment: adjustmentCents.trim() ? { cents: Number(adjustmentCents), reason: adjustmentReason } : null,
            commercialCharge: chargeCents.trim() ? { kind: chargeKind, cents: Number(chargeCents), ...(chargeDescription.trim() ? { description: chargeDescription } : {}) } : null,
          },
        },
      );
    },
    onSuccess: (result) => {
      completeRequest("save");
      applyQuoteResult(result, organizationId, sessionScope);
      setNotice("Quote saved.");
    },
    onError: handleMutationError,
  });

  const lineChange = useMutation({
    mutationFn: (lineChanges: unknown[]) => {
      const payload = {
        organizationId,
        quoteId: quote!.quote.quoteId,
        revision: quote!.revision,
        lineChanges,
      };
      return quoteApi.patch(
        organizationId,
        quote!.quote.quoteId,
        requestId("line-change", payload),
        { expectedRevision: quote!.revision, lineChanges },
      );
    },
    onSuccess: (result) => {
      completeRequest("line-change");
      applyQuoteResult(result, organizationId, sessionScope);
      setEditingLineId("");
      setAddEditorVersion((value) => value + 1);
      setNotice("Quote line saved.");
    },
    onError: handleMutationError,
  });

  const duplicate = useMutation({
    mutationFn: () =>
      quoteApi.duplicate(
        organizationId,
        quote!.quote.quoteId,
        requestId("duplicate", { organizationId, quoteId: quote!.quote.quoteId }),
      ),
    onSuccess: (result) => {
      completeRequest("duplicate");
      applyQuoteResult(result, organizationId, sessionScope);
      setNotice(`New Draft Quote #${result.quote.number.display} created.`);
      load(result.quote.quote.quoteId);
    },
    onError: handleMutationError,
  });

  const action = useMutation({
    mutationFn: () =>
      quoteApi.action(
        organizationId,
        quote!.quote.quoteId,
        "send",
        requestId("action:send", {
          organizationId,
          quoteId: quote!.quote.quoteId,
          revision: quote!.revision,
        }),
        quote!.revision,
      ),
    onSuccess: (result) => {
      completeRequest("action:send");
      applyQuoteResult(result, organizationId, sessionScope);
      setSendDialogOpen(false);
      setNotice("Quote PDF delivered to the selected contact and recorded as immutable Sales evidence.");
    },
    onError: handleMutationError,
  });

  const accept = useMutation({
    mutationFn: () =>
      quoteApi.accept(
        organizationId,
        quote!.quote.quoteId,
        requestId("accept", {
          organizationId,
          quoteId: quote!.quote.quoteId,
          revision: quote!.revision,
        }),
        quote!.revision,
      ),
    onSuccess: (result) => {
      completeRequest("accept");
      applyQuoteResult({ quote: result.quote }, organizationId, sessionScope);
      setAcceptDialogOpen(false);
      setNotice(`Quote accepted and converted to Order ${result.orderNumber}.`);
      void queryClient.invalidateQueries({
        queryKey: ["v2", sessionScope, organizationId, "sales"],
      });
      openOrder?.(result.orderId);
    },
    onError: handleMutationError,
  });
  const terminal = useMutation({
    mutationFn: (input: Readonly<{ action: "decline" | "void"; reason: string }>) => quoteApi.action(organizationId, quote!.quote.quoteId, input.action, requestId(`action:${input.action}`, { organizationId, quoteId: quote!.quote.quoteId, revision: quote!.revision, reason: input.reason }), quote!.revision, input.reason),
    onSuccess: (result) => { applyQuoteResult(result, organizationId, sessionScope); setNotice("Quote lifecycle outcome recorded as immutable Sales evidence."); },
    onError: handleMutationError,
  });

  const mutationError =
    error ||
    create.error ||
    save.error ||
    action.error ||
    terminal.error ||
    accept.error ||
    lineChange.error ||
    duplicate.error;
  const quoteDetail = quote
    ? (() => {
        const selectedLine = quote.quote.lines.find(
          (line) => line.lineId === editingLineId,
        );
        const locked = Boolean(quote.quote.convertedOrderId);
        const metadata = (
          <QuoteDocumentMetadata
            customerId={headerCustomerId}
            contactId={headerContactId}
            customers={customers.data ?? []}
            contacts={contacts.data ?? []}
            purchaseOrderNumber={purchaseOrderNumber}
            requestedDueDate={requestedDueDate}
            expiresAt={expiresAt}
            termsCode={termsCode}
            canEdit={canEdit}
            readOnly={locked}
            onCustomerChange={(value) => {
              const next = clearContactForCustomerChange(value);
              setHeaderCustomerId(next.customerId);
              setHeaderContactId(next.contactId);
            }}
            onContactChange={setHeaderContactId}
            onPurchaseOrderChange={setPurchaseOrderNumber}
            onDueDateChange={setRequestedDueDate}
            onExpiresAtChange={setExpiresAt}
            onTermsCodeChange={setTermsCode}
          />
        );
        const headerActions = locked ? (
          quote.quote.convertedOrderId ? (
            <button
              className="button"
              type="button"
              onClick={() => openOrder?.(quote.quote.convertedOrderId!)}
            >
              Open converted Order
            </button>
          ) : null
        ) : (
          <>
            <button
              className="button secondary"
              type="button"
              onClick={() =>
                openCustomer?.(quote.quote.customerContact.customerId)
              }
            >
              Open Customer
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => window.open(`/v2/organizations/${encodeURIComponent(organizationId)}/quotes/${encodeURIComponent(quote.quote.quoteId)}/document.pdf`, "_blank", "noopener,noreferrer")}
            >
              Preview PDF
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={!canCreate || duplicate.isPending || !csrfReady}
              onClick={() => duplicate.mutate()}
            >
              {duplicate.isPending ? "Duplicating…" : "Duplicate Quote"}
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={!canEdit || save.isPending || !csrfReady}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : "Save"}
            </button>
            {quote.quote.deliveryState === "not_sent" && canSend && (
              <button
                className="button"
                type="button"
                disabled={action.isPending || !csrfReady}
                onClick={() => setSendDialogOpen(true)}
              >
                Send Quote
              </button>
            )}
            {(quote.quote.lifecycleState ?? "open") === "open" && !quote.quote.convertedOrderId && (
              <button className="button secondary" type="button" disabled={terminal.isPending || !csrfReady} onClick={() => {
                const action = quote.quote.deliveryState === "sent" ? "decline" : "void";
                const reason = window.prompt(action === "decline" ? "Customer decline reason (required):" : "Void reason (required):");
                if (reason?.trim()) terminal.mutate({ action, reason: reason.trim() });
                else if (reason !== null) setNotice("A reason is required.");
              }}>{quote.quote.deliveryState === "sent" ? "Record decline" : "Void Quote"}</button>
            )}
            {quote.quote.deliveryState === "sent" &&
              quote.quote.acceptanceState === "not_accepted" &&
              canEdit &&
              canSend &&
              canConvert && (
                <button
                  className="button"
                  type="button"
                  disabled={accept.isPending || !csrfReady || quote.quote.taxComposition?.status === "unresolved"}
                  onClick={() => setAcceptDialogOpen(true)}
                >
                  Accept Quote & Create Order
                </button>
              )}
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
                      {quote.quote.lines.length} line
                      {quote.quote.lines.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  {!locked && (
                    <button
                      type="button"
                      className="v2-sales-add-line"
                      disabled={!canEdit || lineChange.isPending || !csrfReady}
                      onClick={() => setEditingLineId("__add__")}
                    >
                      Add line
                    </button>
                  )}
                </header>
                {loading ? (
                  <div className="skeleton" />
                ) : (
                  <div className="v2-sales-items-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>Configuration</th>
                          <th>Qty</th>
                          <th>Unit</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {quote.quote.lines.map((line) => (
                          <tr
                            key={line.lineId}
                            className={
                              line.lineId === selectedLine?.lineId
                                ? "is-selected"
                                : ""
                            }
                            onClick={() =>
                              !locked &&
                              setEditingLineId((current) =>
                                current === line.lineId ? "" : line.lineId,
                              )
                            }
                          >
                            <td>
                              <button type="button">
                                <i>
                                  {line.description.slice(0, 1).toUpperCase() ||
                                    "P"}
                                </i>
                                <span>
                                  <b>{quoteLineProductPresentation(line)}</b>
                                  {line.sellingPriceDecision.kind !==
                                    "calculated" && <em>Manual price</em>}
                                </span>
                              </button>
                            </td>
                            <td>{lineConfiguration(line)}</td>
                            <td className="num">{line.quantity}</td>
                            <td className="num">
                              {money(line.sellingUnitAmount)}
                            </td>
                            <td className="num strong">
                              {money(line.sellingLineAmount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <footer>
                  <SalesTotals
                    calculated={quote.totals.calculatedLineAmount}
                    selling={quote.totals.sellingLineAmount}
                  />
                </footer>
              </section>
            }
            right={
              selectedLine && !locked ? (
                <section className="v2-sales-line-editor">
                  <header>
                    <div>
                      <small>LINE {selectedLine.position}</small>
                      <h2>
                        {quoteLineProductPresentation(selectedLine)}
                      </h2>
                    </div>
                    <button
                      className="button secondary"
                      type="button"
                      disabled={!canEdit || lineChange.isPending || !csrfReady}
                      onClick={() =>
                        lineChange.mutate([
                          { kind: "duplicate", sourceLineId: selectedLine.lineId },
                        ])
                      }
                    >
                      Duplicate line
                    </button>
                    <button
                      className="button secondary"
                      type="button"
                      disabled={!canEdit || lineChange.isPending || !csrfReady || selectedLine.position === 1}
                      onClick={() => {
                        const ids = quote.quote.lines.map((line) => line.lineId);
                        const index = ids.indexOf(selectedLine.lineId);
                        [ids[index - 1], ids[index]] = [ids[index]!, ids[index - 1]!];
                        lineChange.mutate([{ kind: "reorder", lineIds: ids }]);
                      }}
                    >
                      Move up
                    </button>
                    <button
                      className="button secondary"
                      type="button"
                      disabled={!canEdit || lineChange.isPending || !csrfReady || selectedLine.position === quote.quote.lines.length}
                      onClick={() => {
                        const ids = quote.quote.lines.map((line) => line.lineId);
                        const index = ids.indexOf(selectedLine.lineId);
                        [ids[index], ids[index + 1]] = [ids[index + 1]!, ids[index]!];
                        lineChange.mutate([{ kind: "reorder", lineIds: ids }]);
                      }}
                    >
                      Move down
                    </button>
                    <button
                      className="v2-sales-remove-line"
                      type="button"
                      disabled={!canEdit || lineChange.isPending || !csrfReady}
                      onClick={() =>
                        lineChange.mutate([
                          { kind: "remove", lineId: selectedLine.lineId },
                        ])
                      }
                    >
                      Remove
                    </button>
                  </header>
                  {!canOverridePrice && (
                    <p className="v2-sales-permission-note">
                      Price overrides are unavailable for this permission set;
                      existing decisions remain visible.
                    </p>
                  )}
                  <QuoteLineEditor
                    organizationId={organizationId}
                    sessionScope={sessionScope}
                    draftKey={`edit:${selectedLine.lineId}:${quote.revision}`}
                    initialDraft={draftFromQuoteLine(selectedLine)}
                    initializeFromPersistedLine
                    products={products.data ?? []}
                    canOverridePrice={canOverridePrice}
                    csrfReady={csrfReady}
                    busy={lineChange.isPending || !canEdit}
                    submitLabel="Save and reprice line"
                    onSubmit={(input) =>
                      lineChange.mutate([
                        {
                          kind: "update",
                          lineId: selectedLine.lineId,
                          line: input,
                        },
                      ])
                    }
                    onCancel={() => setEditingLineId("")}
                  />
                </section>
              ) : editingLineId === "__add__" && !locked ? (
                <section className="v2-sales-line-editor">
                  <header>
                    <div>
                      <small>NEW LINE</small>
                      <h2>Add item</h2>
                    </div>
                  </header>
                  <QuoteLineEditor
                    organizationId={organizationId}
                    sessionScope={sessionScope}
                    draftKey={`add:${quote.quote.quoteId}:${addEditorVersion}`}
                    initialDraft={emptyQuoteLineDraft()}
                    products={products.data ?? []}
                    canOverridePrice={canOverridePrice}
                    csrfReady={csrfReady}
                    busy={lineChange.isPending || !canEdit}
                    submitLabel="Add line and price"
                    onSubmit={(input) =>
                      lineChange.mutate([{ kind: "add", line: input }])
                    }
                    onCancel={() => setEditingLineId("")}
                  />
                </section>
              ) : null
            }
          />
        );
        return (
          <div className="lab v2-quote-detail">
            <SalesDocumentFrame
              documentType="Quote"
              number={quote.number.display}
              readOnly={locked}
              readOnlyLabel="Converted · read only"
              status={
                locked ? (
                  <Status value="converted" />
                ) : (
                  <>
                    <Status value={quote.quote.deliveryState} />
                    <Status value={quote.quote.acceptanceState} />
                  </>
                )
              }
              headerActions={headerActions}
              metadata={metadata}
              panels={{
                Items: items,
                Artwork: (
                  <SalesDocumentEmpty>
                    No artwork is attached to this Quote in the available V2
                    sales read model.
                  </SalesDocumentEmpty>
                ),
                Notes: (
                  <section className="v2-sales-notes">
                    <h2>Commercial &amp; fulfillment</h2>
                    <label className="field">Requested fulfillment
                      <select value={fulfillmentMethod} disabled={!canEdit || locked} onChange={(event) => setFulfillmentMethod(event.target.value as typeof fulfillmentMethod)}>
                        <option value="pickup">Pickup</option><option value="shipping">Shipping</option><option value="local_delivery">Local delivery</option>
                      </select>
                    </label>
                    {fulfillmentMethod !== "pickup" && <div className="v2-sales-inline-grid">
                      <label className="field">Street<input value={destinationAddress} disabled={!canEdit || locked} onChange={(event) => setDestinationAddress(event.target.value)} /></label>
                      <label className="field">City<input value={destinationCity} disabled={!canEdit || locked} onChange={(event) => setDestinationCity(event.target.value)} /></label>
                      <label className="field">Region<input value={destinationRegion} disabled={!canEdit || locked} onChange={(event) => setDestinationRegion(event.target.value)} /></label>
                      <label className="field">Country<input value={destinationCountry} disabled={!canEdit || locked} onChange={(event) => setDestinationCountry(event.target.value)} /></label>
                      <label className="field">Postal code<input value={destinationPostalCode} disabled={!canEdit || locked} onChange={(event) => setDestinationPostalCode(event.target.value)} /></label>
                    </div>}
                    <label className="field">Instructions<textarea value={fulfillmentInstructions} disabled={!canEdit || locked} onChange={(event) => setFulfillmentInstructions(event.target.value)} /></label>
                    <div className="v2-sales-inline-grid">
                      <label className="field">Adjustment (¢)<input inputMode="numeric" value={adjustmentCents} disabled={!canEdit || locked} onChange={(event) => setAdjustmentCents(event.target.value)} /></label>
                      <label className="field">Adjustment reason<input value={adjustmentReason} disabled={!canEdit || locked} onChange={(event) => setAdjustmentReason(event.target.value)} /></label>
                      <label className="field">Commercial charge
                        <select value={chargeKind} disabled={!canEdit || locked} onChange={(event) => setChargeKind(event.target.value as typeof chargeKind)}><option value="shipping">Shipping</option><option value="delivery">Delivery</option><option value="handling">Handling</option><option value="packing">Packing</option><option value="crating">Crating</option><option value="postage">USPS postage</option></select>
                      </label>
                      <label className="field">Charge (¢)<input inputMode="numeric" value={chargeCents} disabled={!canEdit || locked} onChange={(event) => setChargeCents(event.target.value)} /></label>
                    </div>
                    {quote.quote.taxComposition?.status === "unresolved" ? <p className="v2-sales-permission-note">Tax jurisdiction not configured. This Quote cannot be accepted or converted until a configured receipt jurisdiction matches.</p> : quote.quote.taxComposition ? <p><b>Tax</b> {money({ currency: quote.quote.currency, cents: quote.quote.taxComposition.taxCents ?? 0 })} · {quote.quote.taxComposition.jurisdiction?.name ?? "configured jurisdiction"} · final {money({ currency: quote.quote.currency, cents: quote.quote.taxComposition.finalTotalCents })}</p> : <p>Tax composition will be shown after the Quote is saved.</p>}
                    <label className="field">
                      Commercial notes
                      <textarea
                        value={commercialNotes}
                        disabled={!canEdit || locked}
                        onChange={(event) =>
                          setCommercialNotes(event.target.value)
                        }
                        placeholder="No commercial notes"
                      />
                    </label>
                    <p>Save changes to persist notes with this Quote.</p>
                  </section>
                ),
                History: (
                  <section className="v2-sales-history">
                    <h2>History</h2>
                    {quote.checkpoints.length ? (
                      <ol>
                        {quote.checkpoints.map((checkpoint) => (
                          <li key={checkpoint.checkpointId}>
                            <b>{checkpoint.kind.replaceAll("_", " ")}</b>
                            <span>
                              {new Date(checkpoint.occurredAt).toLocaleString()}
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p>No lifecycle checkpoints are available.</p>
                    )}
                  </section>
                ),
              }}
            />
          </div>
        );
      })()
    : null;

  return (
    <section className="lab v2-sales-workspace v2-quote-workspace">
      {Boolean(mutationError) && (
        <div className="notice error">
          {errorText(mutationError)}{" "}
          {(mutationError as ApiError).code === "STALE_STATE" && (
            <button className="button secondary" onClick={reload}>
              Reload current Quote
            </button>
          )}
        </div>
      )}
      {notice && <div className="notice">{notice}</div>}
      {!quote ? (
        <SalesDocumentFrame
          documentType="Quote"
          number="New"
          status={<Status value="draft" />}
          metadata={
            <QuoteDocumentMetadata
              customerId={customerId}
              contactId={contactId}
              customers={customers.data ?? []}
              contacts={contacts.data ?? []}
              purchaseOrderNumber={purchaseOrderNumber}
              requestedDueDate={requestedDueDate}
              expiresAt={expiresAt}
              termsCode={termsCode}
              onCustomerChange={(value) => {
                const next = clearContactForCustomerChange(value);
                setCustomerId(next.customerId);
                setContactId(next.contactId);
              }}
              onContactChange={setContactId}
              onPurchaseOrderChange={setPurchaseOrderNumber}
              onDueDateChange={setRequestedDueDate}
              onExpiresAtChange={setExpiresAt}
              onTermsCodeChange={setTermsCode}
            />
          }
          panels={{
            Items: (
              <section className="v2-sales-line-editor v2-sales-new-quote">
                <header>
                  <div>
                    <small>NEW LINE</small>
                    <h2>Items</h2>
                  </div>
                </header>
                <QuoteLineEditor
                  organizationId={organizationId}
                  sessionScope={sessionScope}
                  draftKey={`create:${organizationId}`}
                  initialDraft={emptyQuoteLineDraft()}
                  products={products.data ?? []}
                  canOverridePrice={canOverridePrice}
                  csrfReady={csrfReady}
                  busy={create.isPending}
                  submitLabel="Create Quote"
                  onSubmit={(line) => {
                    if (!customerId) {
                      setNotice("Select a Customer before creating the Quote.");
                      return;
                    }
                    create.mutate(line);
                  }}
                />
              </section>
            ),
            Artwork: (
              <SalesDocumentEmpty>No artwork is attached.</SalesDocumentEmpty>
            ),
            Notes: (
              <section className="v2-sales-notes">
                <label className="field">
                  Commercial notes
                  <textarea
                    value={commercialNotes}
                    onChange={(event) => setCommercialNotes(event.target.value)}
                  />
                </label>
              </section>
            ),
            History: <SalesDocumentEmpty>No history yet.</SalesDocumentEmpty>,
          }}
        />
      ) : (
        quoteDetail
      )}
      {sendDialogOpen && quote && (
        <div
          className="v2-quote-send-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Send Quote"
        >
          <div>
            <header>
              <div>
                <h2>Send Quote</h2>
                <p>{quote.number.display}</p>
              </div>
              <button type="button" onClick={() => setSendDialogOpen(false)}>
                Close
              </button>
            </header>
            <p className="v2-quote-send-notice">This sends the authoritative Quote PDF through the configured tenant Gmail connection. The recipient is the selected Quote contact; recipient, document fingerprint, provider message identity, and immutable Quote checkpoint are recorded server-side.</p>
            <p className="v2-quote-send-notice"><strong>Recipient:</strong> {sendReadinessError ? (sendReadinessError.code === "FORBIDDEN" ? "Your session or permission no longer allows Quote delivery. Reload and sign in again if needed." : sendReadinessError.message ?? "Quote send readiness is temporarily unavailable.") : sendReadiness.data?.recipient.status === "ready" ? sendReadiness.data.recipient.email : sendReadiness.data?.recipient.status === "contact_missing" ? "Select a Quote contact before sending." : sendReadiness.data?.recipient.status === "contact_unavailable" ? "The selected Quote contact is unavailable." : "The selected Quote contact needs a valid email address."}</p>
            <p className="v2-quote-send-notice"><strong>Tenant email:</strong> {sendReadinessError ? "Readiness could not be confirmed." : sendReadiness.data?.email.status === "ready" ? `Ready (${sendReadiness.data.email.sendingAddress ?? "Gmail"})` : sendReadiness.data?.email.actionRequired ?? "Email integration is not configured."}</p>
            {sendReadiness.data?.tax.status === "unresolved" && <p className="v2-quote-send-notice">Authoritative tax must be resolved before a customer document can be sent.</p>}
            {sendReadiness.data?.routability.status === "unroutable" && <p className="v2-quote-send-notice">This Quote contains a Product that is not fully configured for production routing{sendReadiness.data.routability.productNames?.length ? `: ${sendReadiness.data.routability.productNames.join(", ")}.` : "."}</p>}
            <label className="v2-quote-send-pdf">
              <input aria-label="Attach Quote PDF" type="checkbox" checked readOnly />
              Attach authoritative Quote PDF
            </label>
            <footer>
              <button
                className="button secondary"
                type="button"
                onClick={() => setSendDialogOpen(false)}
                disabled={action.isPending}
              >
                Cancel
              </button>
              <button
                className="button"
                type="button"
                onClick={() => action.mutate()}
                disabled={
                  !csrfReady || action.isPending || sendReadiness.isLoading || sendReadiness.data?.canSend !== true
                }
              >
                {action.isPending ? "Sending…" : "Send Quote PDF"}
              </button>
            </footer>
          </div>
        </div>
      )}
      {acceptDialogOpen && quote && (
        <div
          className="v2-quote-send-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Accept Quote and create Order"
        >
          <div>
            <header>
              <div>
                <h2>Accept Quote &amp; Create Order</h2>
                <p>{quote.number.display}</p>
              </div>
              <button type="button" onClick={() => setAcceptDialogOpen(false)}>
                Close
              </button>
            </header>
            <p className="v2-quote-send-notice">
              This accepts the frozen commercial Quote and creates its canonical
              Order and Draft Invoice in one operation. It does not send
              customer communication, take payment, or check inventory
              availability.
            </p>
            <dl className="v2-quote-accept-summary">
              <div>
                <dt>Contact</dt>
                <dd>
                  {recipientContact.data?.displayName ?? "Selected contact"}
                </dd>
              </div>
              <div>
                <dt>Quote total</dt>
                <dd>{money(quote.totals.sellingLineAmount)}</dd>
              </div>
              <div>
                <dt>Lines</dt>
                <dd>{quote.quote.lines.length}</dd>
              </div>
            </dl>
            <footer>
              <button
                className="button secondary"
                type="button"
                onClick={() => setAcceptDialogOpen(false)}
                disabled={accept.isPending}
              >
                Cancel
              </button>
              <button
                className="button"
                type="button"
                onClick={() => accept.mutate()}
                disabled={!csrfReady || accept.isPending}
              >
                {accept.isPending ? "Accepting…" : "Accept & Create Order"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
};
