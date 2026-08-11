import { getProofingQueueDueDate } from "./proofingQueueDueDate";

const now = new Date(2026, 7, 11, 10, 0, 0);

describe("getProofingQueueDueDate", () => {
  test("labels overdue, today, tomorrow, and future dates with readable text", () => {
    expect(getProofingQueueDueDate("2026-08-10T00:00:00.000Z", now)).toMatchObject({ label: "OVERDUE", tone: "overdue" });
    expect(getProofingQueueDueDate("2026-08-11T00:00:00.000Z", now)).toMatchObject({ label: "DUE TODAY", tone: "today" });
    expect(getProofingQueueDueDate("2026-08-12T00:00:00.000Z", now)).toMatchObject({ label: "DUE TOMORROW", tone: "tomorrow" });
    expect(getProofingQueueDueDate("2026-08-15T00:00:00.000Z", now)).toMatchObject({ label: "DUE AUG 15", tone: "future" });
  });

  test("omits missing or invalid due dates", () => {
    expect(getProofingQueueDueDate(null, now)).toBeNull();
    expect(getProofingQueueDueDate("not-a-date", now)).toBeNull();
  });
});
