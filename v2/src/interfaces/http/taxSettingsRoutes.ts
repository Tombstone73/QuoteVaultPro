import { Router, type Request, type Response } from "express";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import type { Principal } from "../../authorization/principals.js";
import type { V2Logger } from "../../observability/logger.js";
import { principalLogContext } from "../../observability/operationContext.js";
import {
  homeBusinessTaxSettingsInput,
  destinationTaxJurisdictionInput,
  type HomeBusinessTaxSettings,
  type SalesTaxJurisdiction,
  type SalesTaxSettingsSaveTrace,
} from "../../modules/sales/taxSettings.js";

export type TaxSettingsHttpDependencies = Readonly<{
  settings: Readonly<{
    read(organizationId: string): Promise<HomeBusinessTaxSettings>;
    save(
      organizationId: string,
      input: ReturnType<typeof homeBusinessTaxSettingsInput>,
      principal: Principal,
      requestId: string,
      trace?: SalesTaxSettingsSaveTrace,
    ): Promise<HomeBusinessTaxSettings>;
    listDestinationJurisdictions(organizationId: string): Promise<readonly SalesTaxJurisdiction[]>;
    createDestinationJurisdiction(organizationId: string, input: ReturnType<typeof destinationTaxJurisdictionInput>, principal: Principal, requestId: string): Promise<HomeBusinessTaxSettings>;
    updateDestinationJurisdiction(organizationId: string, jurisdictionId: string, input: ReturnType<typeof destinationTaxJurisdictionInput>, principal: Principal, requestId: string): Promise<HomeBusinessTaxSettings>;
  }>;
  principals: Readonly<{ principal(request: Request, organizationId: string): Promise<Principal> }>;
  logger: V2Logger;
}>;

const operation = "sales.tax.home_business.configure.v1";
const errorCode = (cause: unknown) =>
  cause instanceof V2ApplicationError ? cause.code : "INTERNAL_ERROR";
const requestId = (body: unknown) =>
  body && typeof body === "object" && typeof (body as { businessRequestId?: unknown }).businessRequestId === "string"
    ? (body as { businessRequestId: string }).businessRequestId.trim() || undefined
    : undefined;
const requireRequestId = (body: unknown) => {
  const value = requestId(body);
  if (!value) throw new V2ApplicationError("VALIDATION_ERROR", "businessRequestId is required.");
  return value;
};
const failure = (cause: unknown) => {
  const error = cause instanceof V2ApplicationError
    ? cause
    : new V2ApplicationError("INTERNAL_ERROR", "Sales Tax settings are unavailable.");
  const status = error.code === "VALIDATION_ERROR" ? 400
    : error.code === "FORBIDDEN" ? 403
      : error.code === "NOT_FOUND" || error.code === "WRONG_TENANT" ? 404
        : error.code === "STALE_STATE" || error.code === "CONFLICT" || error.code === "IDEMPOTENCY_CONFLICT" ? 409
          : 500;
  return { error, status };
};

export const createTaxSettingsRouter = (dependencies: TaxSettingsHttpDependencies) => {
  const router = Router({ mergeParams: true });
  const authenticate = async (request: Request) => {
    const organizationId = (request.params as { organizationId?: string }).organizationId;
    if (!organizationId) throw new V2ApplicationError("VALIDATION_ERROR", "organizationId is required.");
    const principal = await dependencies.principals.principal(request, organizationId);
    return { organizationId, principal };
  };
  const authorize = (organizationId: string, principal: Principal) => {
    if (
      principal.organizationId !== organizationId ||
      !new AuthorityPolicy().decide(principal, { capability: "pricing.configure", resource: { organizationId } }).allowed
    ) {
      throw new V2ApplicationError("FORBIDDEN", "You do not have permission to configure Sales Tax.");
    }
  };
  const auth = async (request: Request) => {
    const value = await authenticate(request);
    authorize(value.organizationId, value.principal);
    return value;
  };

  router.get("/", async (request, response) => {
    try {
      const { organizationId } = await auth(request);
      response.json({ ok: true, data: await dependencies.settings.read(organizationId) });
    } catch (cause) {
      const { error, status } = failure(cause);
      response.status(status).json({ ok: false, error: { code: error.code, message: error.publicMessage } });
    }
  });

  router.put("/home-business", async (request, response) => {
    const organizationId = (request.params as { organizationId?: string }).organizationId;
    const businessRequestId = requestId(request.body);
    const base = {
      operationId: operation,
      ...(organizationId ? { organizationId } : {}),
      ...(businessRequestId ? { businessRequestId } : {}),
    };
    const trace: SalesTaxSettingsSaveTrace = (stage, context = {}) =>
      dependencies.logger.log(
        stage.endsWith("failed") || stage.endsWith("rolled_back") ? "warn" : "info",
        `v2.sales_tax_settings.save.${stage}`,
        { ...base, ...context },
      );
    dependencies.logger.log("info", "v2.sales_tax_settings.save.request_received", base);
    try {
      let authorized: Awaited<ReturnType<typeof authenticate>>;
      try {
        authorized = await authenticate(request);
      } catch (cause) {
        dependencies.logger.log("warn", "v2.sales_tax_settings.save.auth_rejected", { ...base, errorCode: errorCode(cause) });
        throw cause;
      }
      dependencies.logger.log("info", "v2.sales_tax_settings.save.authenticated", {
        ...base,
        ...principalLogContext(authorized.principal),
      });
      try {
        authorize(authorized.organizationId, authorized.principal);
      } catch (cause) {
        dependencies.logger.log("warn", "v2.sales_tax_settings.save.capability_rejected", {
          ...base,
          ...principalLogContext(authorized.principal),
          errorCode: errorCode(cause),
        });
        throw cause;
      }
      dependencies.logger.log("info", "v2.sales_tax_settings.save.authorized", {
        ...base,
        ...principalLogContext(authorized.principal),
      });
      let input: ReturnType<typeof homeBusinessTaxSettingsInput>;
      let durableId: string;
      try {
        input = homeBusinessTaxSettingsInput(request.body);
        durableId = requireRequestId(request.body);
      } catch (cause) {
        dependencies.logger.log("warn", "v2.sales_tax_settings.save.validation_rejected", {
          ...base,
          ...principalLogContext(authorized.principal),
          errorCode: errorCode(cause),
        });
        throw cause;
      }
      dependencies.logger.log("info", "v2.sales_tax_settings.save.validated", {
        ...base,
        ...principalLogContext(authorized.principal),
      });
      const value = await dependencies.settings.save(
        authorized.organizationId,
        input,
        authorized.principal,
        durableId,
        trace,
      );
      dependencies.logger.log("info", "v2.sales_tax_settings.save.response_sent", {
        ...base,
        ...principalLogContext(authorized.principal),
        resourceType: "sales_tax_jurisdiction",
        resourceId: value.homeBusiness?.jurisdictionId,
        httpStatus: 200,
      });
      response.json({ ok: true, data: value });
    } catch (cause) {
      const { error, status } = failure(cause);
      dependencies.logger.log("warn", "v2.sales_tax_settings.save.response_sent", {
        ...base,
        errorCode: error.code,
        httpStatus: status,
      });
      response.status(status).json({ ok: false, error: { code: error.code, message: error.publicMessage } });
    }
  });
  router.get("/destination-jurisdictions", async (request, response) => {
    try { const { organizationId } = await auth(request); response.json({ ok: true, data: { jurisdictions: await dependencies.settings.listDestinationJurisdictions(organizationId), readiness: (await dependencies.settings.read(organizationId)).readiness } }); }
    catch (cause) { const { error, status } = failure(cause); response.status(status).json({ ok: false, error: { code: error.code, message: error.publicMessage } }); }
  });
  const destination = (kind: "create" | "update") => async (request: Request, response: Response) => {
    try {
      const { organizationId, principal } = await auth(request);
      const durableId = requireRequestId(request.body);
      const input = destinationTaxJurisdictionInput(request.body);
      const data = kind === "create"
        ? await dependencies.settings.createDestinationJurisdiction(organizationId, input, principal, durableId)
        : await dependencies.settings.updateDestinationJurisdiction(organizationId, String(request.params.jurisdictionId ?? ""), input, principal, durableId);
      response.status(kind === "create" ? 201 : 200).json({ ok: true, data });
    } catch (cause) { const { error, status } = failure(cause); response.status(status).json({ ok: false, error: { code: error.code, message: error.publicMessage } }); }
  };
  router.post("/destination-jurisdictions", destination("create"));
  router.put("/destination-jurisdictions/:jurisdictionId", destination("update"));
  return router;
};
