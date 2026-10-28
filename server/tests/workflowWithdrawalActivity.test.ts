import { classifyPrepressWithdrawalActivity } from "../services/workflowWithdrawalActivity";
const empty = { job: { status: "queued", startedAt: null, totalSeconds: 0 }, sessions: [], hasStageFiles: false, hasMaterialActivity: false, events: [{ type: "intake" }, { type: "note", payload: { eventType: "workflow_transition" } }] };
test("assignment and an empty session are not meaningful work", () => {
  expect(classifyPrepressWithdrawalActivity({ ...empty, sessions: [{ status: "active", notesText: null, issueFlag: false }] })).toEqual([]);
});
test.each([
  { ...empty, job: { ...empty.job, totalSeconds: 2 } },
  { ...empty, sessions: [{ status: "active", notesText: "adjusted artwork" }] },
  { ...empty, hasStageFiles: true },
  { ...empty, hasMaterialActivity: true },
  { ...empty, events: [{ type: "unknown" }] },
])("recorded or ambiguous work requires confirmation", input => {
  expect(classifyPrepressWithdrawalActivity(input).length).toBeGreaterThan(0);
});