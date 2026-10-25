import { describe, expect, test } from "@jest/globals";
import { extractAssistantAttachment } from "../services/assistantAttachmentExtraction";
import { createAssistantAttachmentAnalysisTools } from "../services/assistant/attachmentAnalysisTools";

const attachmentId = "00000000-0000-4000-8000-000000000042";
const extracted = extractAssistantAttachment(Buffer.from([
  "Customer PO,Amount,Currency",
  "00042,12.00,USD",
  "00042,12.00,USD",
  "00043,8.00,EUR",
  "00044,5.00,USD",
  "00045,3.00,USD",
  "00046,oops,",
].join("\n")), "comparison.csv");
const rows = [
  { id: "order_42", key: "00042", amount: "11.00" },
  { id: "order_43", key: "00043", amount: "8.00" },
  { id: "order_45a", key: "00045", amount: "3.00" },
  { id: "order_45b", key: "00045", amount: "3.00" },
  { id: "order_46", key: "00046", amount: "1.00" },
];

describe("assistant table comparison", () => {
  test("reports deterministic matches, duplicates, differences, unknown currency, and source rows without writes", async () => {
    const file = await extracted;
    let appReadCount = 0;
    const tools = createAssistantAttachmentAnalysisTools({
      readFile: async () => ({ attachment: { id: attachmentId, fileName: "comparison.csv", mimeType: "text/csv", sizeBytes: 120 }, extracted: file }),
      readComparisonRows: async () => { appReadCount++; return rows; },
    });
    const tool = tools.find(item => item.name === "attachments.compare_records")!;
    const context = { scope: { organizationId: "org_test", userId: "staff_test" }, conversationId: "conversation_test", permissions: ["assistant.internal_staff", "finance.read"] } as any;
    const response = await tool.execute({ arguments: { attachmentId, matchColumn: "Customer PO", target: "orders_by_customer_po", amountColumn: "Amount", currencyColumn: "Currency" }, context });
    expect(response.status).toBe("succeeded");
    expect(response.result?.data).toMatchObject({ totalFileRows: 6, matched: 4, unmatched: 1, ambiguous: 1, duplicateFileKeyCount: 1, amountDifferenceCount: 2, invalidAmountCount: 1, currencyDifferenceCount: 1, currencyUnknownCount: 1, fileTotal: "40.00", fileTotalComplete: false });
    expect((response.result?.data as any).details).toEqual(expect.arrayContaining([
      expect.objectContaining({ rowNumber: 2, status: "amount_difference", fileAmount: "12.00", applicationAmount: "11.00" }),
      expect.objectContaining({ rowNumber: 4, status: "currency_mismatch", fileCurrency: "EUR" }),
      expect.objectContaining({ rowNumber: 5, status: "unmatched" }),
      expect.objectContaining({ rowNumber: 6, status: "ambiguous" }),
      expect.objectContaining({ rowNumber: 7, status: "invalid_file_amount" }),
    ]));
    expect(appReadCount).toBe(1);
  });

  test("enforces tenant read and finance permissions before application comparison", async () => {
    let appReadCount = 0;
    const tool = createAssistantAttachmentAnalysisTools({
      readFile: async () => ({ attachment: { id: attachmentId, fileName: "comparison.csv", mimeType: "text/csv", sizeBytes: 120 }, extracted: await extracted }),
      readComparisonRows: async () => { appReadCount++; return rows; },
    }).find(item => item.name === "attachments.compare_records")!;
    const arguments_ = { attachmentId, matchColumn: "Customer PO", target: "orders_by_customer_po", amountColumn: "Amount" };
    const base = { scope: { organizationId: "org_test", userId: "staff_test" }, conversationId: "conversation_test" };
    expect((await tool.execute({ arguments: arguments_, context: { ...base, permissions: [] } as any })).status).toBe("permission_denied");
    expect((await tool.execute({ arguments: arguments_, context: { ...base, permissions: ["assistant.internal_staff"] } as any })).status).toBe("permission_denied");
    expect(appReadCount).toBe(0);
  });

  test("pages long document text and states uncovered content explicitly", async () => {
    const document = await extractAssistantAttachment(Buffer.from("A".repeat(25_000) + "PO 00042"), "po.txt");
    const inspect = createAssistantAttachmentAnalysisTools({
      readFile: async () => ({ attachment: { id: attachmentId, fileName: "po.txt", mimeType: "text/plain", sizeBytes: 25_008 }, extracted: document }),
    }).find(item => item.name === "attachments.inspect")!;
    const response = await inspect.execute({ arguments: { attachmentId, startCharacter: 24_000, charLimit: 2_000 }, context: { scope: { organizationId: "org_test", userId: "staff_test" }, conversationId: "conversation_test", permissions: ["assistant.internal_staff"] } as any });
    expect(response.result?.data).toMatchObject({ startCharacter: 24_000, endCharacter: 25_008, totalCharacters: 25_008, complete: false, omittedBefore: 24_000, omittedAfter: 0 });
    expect((response.result?.data as any).text).toContain("PO 00042");
  });
});
