import { jest } from "@jest/globals";

const { db } = await import("../db");
const { CustomerUploadReviewError, selectCustomerUploadPrimaryArtworkCandidate } = await import("../services/customerUploadReview.service");

function selectRows(rows: unknown[]) {
  return { from: () => ({ where: () => ({ limit: async () => rows }) }) };
}

function sideDesignatedArtworkReference(overrides: Record<string, unknown> = {}) {
  return {
    id: "attachment_1", orderId: "order_1", orderLineItemId: "line_1", fileRecordId: "record_1",
    portalFileCategory: "customer_upload", customerUploadReviewStatus: "accepted", customerUploadPromotionType: "artwork",
    customerUploadAssignmentType: "reference_for_line_item", customerUploadAssignedToOrderLineItemId: "line_1",
    customerUploadArtworkSelectionType: "artwork_side_intake", customerUploadPrimaryCandidateSide: null,
    originalFilename: "customer-art.pdf", fileName: "customer-art.pdf", role: "artwork", side: "front", isPrimary: false,
    ...overrides,
  };
}

const input = {
  organizationId: "org_1", sourceOrderId: "order_1", targetOrderId: "order_1", targetLineItemId: "line_1",
  attachmentId: "attachment_1", side: "front" as const, candidateNote: "Use as the staff primary candidate.",
  actorUserId: "staff_1", actorUserName: "Staff",
};

describe("customer upload primary artwork candidate service", () => {
  afterEach(() => jest.restoreAllMocks());

  test("selects a side-designated upload as an explicit candidate without mutating operational primary or workflow state", async () => {
    const writes: Array<{ kind: string; values: Record<string, unknown> }> = [];
    const attachment = sideDesignatedArtworkReference();
    let updateIndex = 0;
    const tx = {
      select: jest.fn()
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([{ id: "line_1" }]))
        .mockReturnValueOnce(selectRows([attachment]))
        .mockReturnValueOnce(selectRows([]))
        .mockReturnValueOnce({ from: () => ({ where: async () => [] }) }),
      update: jest.fn(() => {
        const index = updateIndex++;
        return { set: (values: Record<string, unknown>) => {
          writes.push({ kind: index === 0 ? "clear-candidates" : "select-candidate", values });
          return { where: () => index === 1 ? { returning: async () => [{ ...attachment, ...values }] } : undefined };
        } };
      }),
      execute: jest.fn(async () => undefined),
      insert: () => ({ values: (values: Record<string, unknown>) => { writes.push({ kind: "audit", values }); return values; } }),
    };
    jest.spyOn(db, "transaction").mockImplementation(async (callback: any) => callback(tx));

    await selectCustomerUploadPrimaryArtworkCandidate(input);

    expect(writes[0]).toMatchObject({ kind: "clear-candidates", values: { customerUploadPrimaryCandidateSide: null } });
    expect(writes[1]).toMatchObject({ kind: "select-candidate", values: {
      customerUploadPrimaryCandidateSide: "front", customerUploadPrimaryCandidateByUserId: "staff_1",
    } });
    for (const forbiddenField of ["isPrimary", "side", "customerUploadReviewStatus", "customerUploadPromotionType"]) {
      expect(writes[1]?.values).not.toHaveProperty(forbiddenField);
    }
    expect(writes[2]).toMatchObject({ kind: "audit", values: {
      actionType: "customer_upload.primary_artwork_candidate_selected",
      newValues: expect.objectContaining({
        actorUserId: "staff_1", sourceAttachmentId: "attachment_1", targetOrderId: "order_1", targetLineItemId: "line_1",
        selectedSide: "front", action: "primary_artwork_candidate_selection", outcome: "primary_candidate_selected",
        replacedCandidateIds: [], finalArtwork: false, primaryArtworkChanged: false, proofChanged: false, prepressChanged: false,
        productionChanged: false, billingChanged: false, paymentChanged: false, epsChanged: false,
      }),
    } });
  });

  test("supersedes only conflicting candidate state and records the replaced candidate", async () => {
    const writes: Array<{ kind: string; values: Record<string, unknown> }> = [];
    const attachment = sideDesignatedArtworkReference();
    let updateIndex = 0;
    const previousCandidate = { id: "attachment_previous", candidateSide: "front", candidateByUserId: "staff_previous", candidateAt: new Date("2026-01-01T00:00:00.000Z") };
    const tx = {
      select: jest.fn()
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([{ id: "line_1" }]))
        .mockReturnValueOnce(selectRows([attachment]))
        .mockReturnValueOnce(selectRows([]))
        .mockReturnValueOnce({ from: () => ({ where: async () => [previousCandidate] }) }),
      update: jest.fn(() => {
        const index = updateIndex++;
        return { set: (values: Record<string, unknown>) => {
          writes.push({ kind: index === 0 ? "clear-candidates" : "select-candidate", values });
          return { where: () => index === 1 ? { returning: async () => [{ ...attachment, ...values }] } : undefined };
        } };
      }),
      execute: jest.fn(async () => undefined),
      insert: () => ({ values: (values: Record<string, unknown>) => { writes.push({ kind: "audit", values }); return values; } }),
    };
    jest.spyOn(db, "transaction").mockImplementation(async (callback: any) => callback(tx));

    await selectCustomerUploadPrimaryArtworkCandidate(input);

    expect(writes[0]?.values).toMatchObject({ customerUploadPrimaryCandidateSide: null, customerUploadPrimaryCandidateByUserId: null });
    expect(writes[2]).toMatchObject({ kind: "audit", values: { newValues: expect.objectContaining({
      replacedCandidateIds: ["attachment_previous"], replacedCandidateDetails: [previousCandidate],
    }) } });
  });

  test.each([
    ["pending", sideDesignatedArtworkReference({ customerUploadReviewStatus: "pending_review" })],
    ["rejected", sideDesignatedArtworkReference({ customerUploadReviewStatus: "rejected" })],
    ["unpromoted", sideDesignatedArtworkReference({ customerUploadPromotionType: null })],
    ["approved-reference", sideDesignatedArtworkReference({ customerUploadPromotionType: "reference" })],
    ["unassigned", sideDesignatedArtworkReference({ customerUploadAssignmentType: null, customerUploadAssignedToOrderLineItemId: null })],
    ["not intake-selected", sideDesignatedArtworkReference({ customerUploadArtworkSelectionType: null })],
    ["not side-designated", sideDesignatedArtworkReference({ side: "na" })],
    ["operational primary", sideDesignatedArtworkReference({ isPrimary: true })],
    ["already candidate", sideDesignatedArtworkReference({ customerUploadPrimaryCandidateSide: "front" })],
    ["wrong side", sideDesignatedArtworkReference({ side: "back" })],
    ["wrong assigned line item", sideDesignatedArtworkReference({ customerUploadAssignedToOrderLineItemId: "line_2" })],
  ])("rejects %s uploads before candidate selection", async (_label, attachment) => {
    const tx = {
      select: jest.fn()
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([{ id: "line_1" }]))
        .mockReturnValueOnce(selectRows([attachment])),
      update: jest.fn(), execute: jest.fn(async () => undefined), insert: jest.fn(),
    };
    jest.spyOn(db, "transaction").mockImplementation(async (callback: any) => callback(tx));

    await expect(selectCustomerUploadPrimaryArtworkCandidate(input)).rejects.toMatchObject<CustomerUploadReviewError>({ statusCode: 409 });
    expect(tx.update).not.toHaveBeenCalled();
  });

  test("rejects a final-art relation before candidate state can change", async () => {
    const attachment = sideDesignatedArtworkReference();
    const tx = {
      select: jest.fn()
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([{ id: "line_1" }]))
        .mockReturnValueOnce(selectRows([attachment]))
        .mockReturnValueOnce(selectRows([{ id: "final_1" }])),
      update: jest.fn(), execute: jest.fn(async () => undefined), insert: jest.fn(),
    };
    jest.spyOn(db, "transaction").mockImplementation(async (callback: any) => callback(tx));

    await expect(selectCustomerUploadPrimaryArtworkCandidate(input)).rejects.toMatchObject<CustomerUploadReviewError>({ statusCode: 409 });
    expect(tx.update).not.toHaveBeenCalled();
  });

  test("rejects a target line item that is not owned by the target order before reading the attachment", async () => {
    const tx = {
      select: jest.fn()
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([])),
      update: jest.fn(), execute: jest.fn(async () => undefined), insert: jest.fn(),
    };
    jest.spyOn(db, "transaction").mockImplementation(async (callback: any) => callback(tx));

    await expect(selectCustomerUploadPrimaryArtworkCandidate({ ...input, targetLineItemId: "line_other" })).rejects.toMatchObject<CustomerUploadReviewError>({ statusCode: 404 });
    expect(tx.select).toHaveBeenCalledTimes(3);
    expect(tx.update).not.toHaveBeenCalled();
  });

  test("rejects a target order outside the source upload customer scope before reading the line item or attachment", async () => {
    const tx = {
      select: jest.fn()
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([{ id: "order_2", customerId: "customer_2" }])),
      update: jest.fn(), execute: jest.fn(async () => undefined), insert: jest.fn(),
    };
    jest.spyOn(db, "transaction").mockImplementation(async (callback: any) => callback(tx));

    await expect(selectCustomerUploadPrimaryArtworkCandidate({ ...input, targetOrderId: "order_2", targetLineItemId: "line_2" })).rejects.toMatchObject<CustomerUploadReviewError>({ statusCode: 404 });
    expect(tx.select).toHaveBeenCalledTimes(2);
  });
});
