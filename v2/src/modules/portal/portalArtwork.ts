import type { OperationContext } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import type { PortalPrincipal } from "../../authorization/principals.js";
import { failure, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import type { ArtworkMutationResult } from "../artwork/contracts.js";

export type PortalCustomerArtworkCommand = Readonly<{
  businessRequestId: string;
  orderId: string;
  orderLineId: string;
  /** Explicit current source-artwork predecessor for immutable replacement. */
  supersedesArtworkAssignmentId?: string;
  side?: "front" | "back";
  sourcePageIndex?: number;
  filename: string;
  contentType: string;
  bytes: Buffer;
}>;

/** A database-backed check; browser order and line IDs are never authority. */
export interface PortalArtworkOwnershipRead {
  assertActiveOwnedOrderLine(principal: PortalPrincipal, orderId: string, orderLineId: string): Promise<void>;
  /** The predecessor must be the customer's current source-artwork slot on that exact open line. */
  assertCurrentOwnedCustomerSuppliedArtwork(principal: PortalPrincipal, orderId: string, orderLineId: string, artworkAssignmentId: string): Promise<void>;
}

export interface CanonicalArtworkUploadPort {
  upload(context: OperationContext, input: PortalCustomerArtworkCommand & Readonly<{ purpose: "customer_supplied" }>): Promise<ApplicationResult<ArtworkMutationResult>>;
  replace(context: OperationContext, input: PortalCustomerArtworkCommand & Readonly<{ purpose: "customer_supplied"; supersedesArtworkAssignmentId: string }>): Promise<ApplicationResult<ArtworkMutationResult>>;
}

/**
 * Portal uploads are intentionally limited to customer-supplied source
 * Artwork on the authenticated Customer's own open Order line.  This is not
 * a general portal Artwork capability: it cannot adopt production Artwork or
 * write an arbitrary tenant's file.  A customer may explicitly replace only
 * their current source-artwork slot; the canonical append-only lineage writer
 * remains authoritative.
 */
export class PortalArtworkApplicationService {
  constructor(
    private readonly ownership: PortalArtworkOwnershipRead,
    private readonly artwork: CanonicalArtworkUploadPort,
    private readonly authority = new AuthorityPolicy(),
  ) {}

  async upload(principal: PortalPrincipal, input: PortalCustomerArtworkCommand): Promise<ApplicationResult<ArtworkMutationResult>> {
    try {
      if (!this.authority.decide(principal, { capability: "order.create", resource: { organizationId: principal.organizationId, customerId: principal.customerId } }).allowed)
        throw new V2ApplicationError("FORBIDDEN", "Artwork upload is unavailable for this Portal account.");
      if (!input.businessRequestId.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "businessRequestId is required.");
      await this.ownership.assertActiveOwnedOrderLine(principal, input.orderId, input.orderLineId);
      if (input.supersedesArtworkAssignmentId)
        await this.ownership.assertCurrentOwnedCustomerSuppliedArtwork(principal, input.orderId, input.orderLineId, input.supersedesArtworkAssignmentId);

      // The canonical Artwork application service remains the only writer.
      // It records the real portal identity in its idempotency and audit
      // records; this narrow boundary supplies artwork.adopt only after the
      // customer/order/line scope has been verified above.
      const boundedPrincipal: PortalPrincipal = {
        ...principal,
        capabilities: [...new Set([...principal.capabilities, "artwork.adopt" as const])],
      };
      const context: OperationContext = {
        principal: boundedPrincipal,
        organizationId: principal.organizationId,
        operationId: "portal.artwork.customer-source-upload",
        businessRequest: {
          id: input.businessRequestId,
          payloadFingerprint: "portal-artwork-upload-fingerprint-is-derived-by-canonical-storage",
        },
      };
      return input.supersedesArtworkAssignmentId
        ? this.artwork.replace(context, { ...input, purpose: "customer_supplied", supersedesArtworkAssignmentId: input.supersedesArtworkAssignmentId })
        : this.artwork.upload(context, { ...input, purpose: "customer_supplied" });
    } catch (cause) {
      return failure(cause instanceof V2ApplicationError ? cause : new V2ApplicationError("RETRYABLE_FAILURE", "Artwork upload is unavailable."));
    }
  }
}
