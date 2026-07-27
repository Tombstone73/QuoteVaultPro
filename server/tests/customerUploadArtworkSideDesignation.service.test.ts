import { jest } from "@jest/globals";

const { db } = await import("../db");
const { CustomerUploadReviewError, designateCustomerUploadArtworkSide } = await import("../services/customerUploadReview.service");

function selectRows(rows: unknown[]) {
  return { from: () => ({ where: () => ({ limit: async () => rows }) }) };
}

function intakeSelectedArtworkReference(overrides: Record<string, unknown> = {}) {
  return {
    id: "attachment_1",
    orderId: "order_1",
    orderLineItemId: "line_1",
    fileRecordId: "record_1",
    portalFileCategory: "customer_upload",
    customerUploadReviewStatus: "accepted",
    customerUploadPromotionType: "artwork",
    customerUploadAssignmentType: "reference_for_line_item",
    customerUploadAssignedToOrderLineItemId: "line_1",
    customerUploadArtworkSelectionType: "artwork_side_intake",
    originalFilename: "customer-art.pdf",
    fileName: "customer-art.pdf",
    role: "artwork",
    side: "na",
    isPrimary: false,
    ...overrides,
  };
}

const input = {
  organizationId: "org_1",
  sourceOrderId: "order_1",
  targetOrderId: "order_1",
  targetLineItemId: "line_1",
  attachmentId: "attachment_1",
  side: "front" as const,
  designationNote: "Customer supplied the front panel.",
  actorUserId: "staff_1",
  actorUserName: "Staff",
};

describe("customer upload artwork-side designation service", () => {
  afterEach(() => jest.restoreAllMocks());

  test.each(["front", "back", "both"] as const)("explicitly designates %s without final-art or workflow mutation", async (side) => {
    const writes: Array<{ kind: string; values: Record<string, unknown> }> = [];
    const attachment = intakeSelectedArtworkReference();
    let updateIndex = 0;
    const tx = {
      select: jest.fn()
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([{ id: "line_1", specsJson: {} }]))
        .mockReturnValueOnce(selectRows([attachment]))
        .mockReturnValueOnce(selectRows([])),
      update: jest.fn(() => {
        const index = updateIndex++;
        return {
          set: (values: Record<string, unknown>) => {
            writes.push({ kind: index === 0 ? "clear-conflicts" : index === 1 ? "designate" : "specs", values });
            return {
              where: () => index === 1 ? { returning: async () => [{ ...attachment, ...values }] } : undefined,
            };
          },
        };
      }),
      insert: () => ({ values: (values: Record<string, unknown>) => { writes.push({ kind: "audit", values }); return values; } }),
    };
    jest.spyOn(db, "transaction").mockImplementation(async (callback: any) => callback(tx));

    await designateCustomerUploadArtworkSide({ ...input, side });

    expect(writes[0]).toMatchObject({ kind: "clear-conflicts", values: { side: "na" } });
    expect(writes[1]).toMatchObject({ kind: "designate", values: { side } });
    for (const forbiddenField of ["isPrimary", "customerUploadReviewStatus", "customerUploadPromotionType"]) {
      expect(writes[1]?.values).not.toHaveProperty(forbiddenField);
    }
    expect(writes[3]).toMatchObject({
      kind: "audit",
      values: {
        actionType: "customer_upload.artwork_side_designated",
        newValues: expect.objectContaining({
          actorUserId: "staff_1", sourceAttachmentId: "attachment_1", targetOrderId: "order_1", targetLineItemId: "line_1",
          selectedSide: side, action: "artwork_side_designation", outcome: "side_designated",
          finalArtwork: false, primaryArtworkChanged: false, prepressChanged: false, proofChanged: false,
          productionChanged: false, billingChanged: false, paymentChanged: false, epsChanged: false,
        }),
      },
    });
  });

  test("preserves active candidate side metadata for the later confirmed supersession action", async () => {
    const writes: Array<{ kind: string; values: Record<string, unknown> }> = [];
    const attachment = intakeSelectedArtworkReference();
    let updateIndex = 0;
    const tx = {
      select: jest.fn()
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([{ id: "line_1", specsJson: {} }]))
        .mockReturnValueOnce(selectRows([attachment]))
        .mockReturnValueOnce(selectRows([])),
      update: jest.fn(() => {
        const index = updateIndex++;
        return {
          set: (values: Record<string, unknown>) => {
            writes.push({ kind: index === 0 ? "clear-non-candidate-conflicts" : index === 1 ? "designate" : "specs", values });
            return { where: () => index === 1 ? { returning: async () => [{ ...attachment, ...values }] } : undefined };
          },
        };
      }),
      insert: () => ({ values: () => undefined }),
    };
    jest.spyOn(db, "transaction").mockImplementation(async (callback: any) => callback(tx));

    await designateCustomerUploadArtworkSide({ ...input, side: "both" });

    expect(writes[0]).toMatchObject({ kind: "clear-non-candidate-conflicts", values: { side: "na" } });
    expect(writes[0]?.values).not.toHaveProperty("customerUploadPrimaryCandidateSide");
    expect(writes[0]?.values).not.toHaveProperty("isPrimary");
  });

  test("normalizes a candidate-side check violation into a controlled conflict", async () => {
    jest.spyOn(db, "transaction").mockRejectedValue({ code: "23514" });

    await expect(designateCustomerUploadArtworkSide(input)).rejects.toMatchObject<CustomerUploadReviewError>({ statusCode: 409 });
  });

  test.each([
    ["pending", intakeSelectedArtworkReference({ customerUploadReviewStatus: "pending_review" })],
    ["rejected", intakeSelectedArtworkReference({ customerUploadReviewStatus: "rejected" })],
    ["accepted-only", intakeSelectedArtworkReference({ customerUploadPromotionType: null })],
    ["approved-reference", intakeSelectedArtworkReference({ customerUploadPromotionType: "reference" })],
    ["unassigned", intakeSelectedArtworkReference({ customerUploadAssignmentType: null, customerUploadAssignedToOrderLineItemId: null })],
    ["not intake-selected", intakeSelectedArtworkReference({ customerUploadArtworkSelectionType: null })],
    ["primary", intakeSelectedArtworkReference({ isPrimary: true })],
    ["already side-designated", intakeSelectedArtworkReference({ side: "front" })],
    ["wrong assigned line item", intakeSelectedArtworkReference({ customerUploadAssignedToOrderLineItemId: "line_2" })],
  ])("rejects %s uploads before side designation", async (_label, attachment) => {
    const tx = {
      select: jest.fn()
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([{ id: "line_1", specsJson: {} }]))
        .mockReturnValueOnce(selectRows([attachment])),
      update: jest.fn(), insert: jest.fn(),
    };
    jest.spyOn(db, "transaction").mockImplementation(async (callback: any) => callback(tx));

    await expect(designateCustomerUploadArtworkSide(input)).rejects.toMatchObject<CustomerUploadReviewError>({ statusCode: 409 });
    expect(tx.update).not.toHaveBeenCalled();
  });

  test("rejects a final-art relation before side metadata can change", async () => {
    const attachment = intakeSelectedArtworkReference();
    const tx = {
      select: jest.fn()
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([{ id: "line_1", specsJson: {} }]))
        .mockReturnValueOnce(selectRows([attachment]))
        .mockReturnValueOnce(selectRows([{ id: "final_1" }])),
      update: jest.fn(), insert: jest.fn(),
    };
    jest.spyOn(db, "transaction").mockImplementation(async (callback: any) => callback(tx));

    await expect(designateCustomerUploadArtworkSide(input)).rejects.toMatchObject<CustomerUploadReviewError>({ statusCode: 409 });
    expect(tx.update).not.toHaveBeenCalled();
  });

  test("rejects a target line item that is not owned by the target order before reading the attachment", async () => {
    const tx = {
      select: jest.fn()
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([])),
      update: jest.fn(), insert: jest.fn(),
    };
    jest.spyOn(db, "transaction").mockImplementation(async (callback: any) => callback(tx));

    await expect(designateCustomerUploadArtworkSide({ ...input, targetLineItemId: "line_other" })).rejects.toMatchObject<CustomerUploadReviewError>({ statusCode: 404 });
    expect(tx.select).toHaveBeenCalledTimes(3);
    expect(tx.update).not.toHaveBeenCalled();
  });

  test("rejects a target order outside the source upload customer scope before reading the line item or attachment", async () => {
    const tx = {
      select: jest.fn()
        .mockReturnValueOnce(selectRows([{ id: "order_1", customerId: "customer_1" }]))
        .mockReturnValueOnce(selectRows([{ id: "order_2", customerId: "customer_2" }])),
      update: jest.fn(), insert: jest.fn(),
    };
    jest.spyOn(db, "transaction").mockImplementation(async (callback: any) => callback(tx));

    await expect(designateCustomerUploadArtworkSide({ ...input, targetOrderId: "order_2", targetLineItemId: "line_2" })).rejects.toMatchObject<CustomerUploadReviewError>({ statusCode: 404 });
    expect(tx.select).toHaveBeenCalledTimes(2);
  });
});
