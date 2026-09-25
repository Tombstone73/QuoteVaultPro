import { describe, expect, test } from "@jest/globals";
import { ArtworkApplicationService, type ArtworkTransaction, type ArtworkTransactionRunner } from "../../src/modules/artwork/artworkApplication";
import type { ArtworkAssignment, ArtworkFile, ArtworkMutationResult } from "../../src/modules/artwork/contracts";
import { brandedId } from "../../src/modules/shared/commercialValues";

const org = "art-org";
const principal = { kind: "staff" as const, organizationId: org, userId: "staff", authority: { membershipId: "membership", capabilities: ["artwork.view", "artwork.adopt", "artwork.assign"] as const } };
const context = (id: string) => ({ principal, organizationId: org, operationId: id, businessRequest: { id, payloadFingerprint: "context" } });
const usage = (overrides: object = {}) => ({ orderId: brandedId<"OrderId">("order"), orderLineId: brandedId<"OrderLineId">("line"), purpose: "production" as const, side: "front" as const, ...overrides });
const input = (id: string, overrides: object = {}) => ({ businessRequestId: id, objectReference: { storageProvider: "test", objectKey: `object/${id}` }, originalFilename: "sign.pdf", contentType: "application/pdf", byteSize: 12, source: "customer_upload" as const, usage: usage(), ...overrides });

class MemoryArtworkTransaction implements ArtworkTransaction {
  readonly files = new Map<string, ArtworkFile>(); readonly assignments = new Map<string, ArtworkAssignment>(); readonly requests = new Map<string, ArtworkMutationResult>(); readonly auditRows: unknown[] = [];
  async reserve(input: Parameters<ArtworkTransaction["reserve"]>[0]) { const prior=this.requests.get(input.businessRequestId); return prior ? { kind: "replay" as const, request:{id:input.businessRequestId,resultJson:prior} } : { kind:"new" as const,request:{id:input.businessRequestId,resultJson:null} }; }
  async succeed(_org:string,requestId:string,result:ArtworkMutationResult) { this.requests.set(requestId,result); }
  async attribute() {} async audit(input: Parameters<ArtworkTransaction["audit"]>[0]) { this.auditRows.push(input); }
  async findFile(_org: never, id: never) { return this.files.get(id) ?? null; }
  async findOrderLineArtwork(_org: never, line: string) { return [...this.assignments.values()].filter((a)=>a.orderLineId===line&&!([...(this.assignments.values())].some((successor)=>successor.supersedesArtworkAssignmentId===a.id))).map((a)=>({assignment:a,file:this.files.get(a.artworkFileId)!})); }
  async findOrderArtwork(_org: never, orderId: string) { return [...this.assignments.values()].filter((a)=>a.orderId===orderId&&!([...(this.assignments.values())].some((successor)=>successor.supersedesArtworkAssignmentId===a.id))).map((a)=>({assignment:a,file:this.files.get(a.artworkFileId)!})); }
  async createOrGetFile(input: Parameters<ArtworkTransaction["createOrGetFile"]>[0]) { const prior=[...this.files.values()].find((f)=>f.objectReference.storageProvider===input.file.objectReference.storageProvider&&f.objectReference.objectKey===input.file.objectReference.objectKey); if(prior)return prior; const f:ArtworkFile={id:input.id,organizationId:input.organizationId,objectReference:input.file.objectReference,originalFilename:input.file.originalFilename,displayFilename:input.file.displayFilename??input.file.originalFilename,contentType:input.file.contentType,byteSize:input.file.byteSize,source:input.file.source,createdAt:"now",...(input.derivedFromArtworkFileId?{derivedFromArtworkFileId:input.derivedFromArtworkFileId}:{})};this.files.set(f.id,f);return f; }
  async createOrGetAssignment(input: Parameters<ArtworkTransaction["createOrGetAssignment"]>[0]) { const prior=[...this.assignments.values()].find((a)=>a.artworkFileId===input.artworkFileId&&a.orderLineId===input.usage.orderLineId&&a.purpose===input.usage.purpose&&a.side===input.usage.side&&a.sourcePageIndex===input.usage.sourcePageIndex&&a.layerKey===input.usage.layerKey&&a.layerOrder===input.usage.layerOrder);if(prior)return prior;const a:ArtworkAssignment={id:input.id,organizationId:input.organizationId,artworkFileId:input.artworkFileId,orderId:input.usage.orderId,orderLineId:input.usage.orderLineId,purpose:input.usage.purpose,createdAt:"now",...(input.usage.side?{side:input.usage.side}:{}),...(input.usage.sourcePageIndex!==undefined?{sourcePageIndex:input.usage.sourcePageIndex}:{}),...(input.usage.layerKey?{layerKey:input.usage.layerKey}:{}),...(input.usage.layerOrder!==undefined?{layerOrder:input.usage.layerOrder}:{})};this.assignments.set(a.id,a);return a; }
  async createOrGetReplacementAssignment(input: Parameters<ArtworkTransaction["createOrGetReplacementAssignment"]>[0]) { const predecessor=this.assignments.get(input.supersedesArtworkAssignmentId);if(!predecessor||predecessor.orderId!==input.usage.orderId||predecessor.orderLineId!==input.usage.orderLineId||predecessor.purpose!=="customer_supplied"||predecessor.side!==input.usage.side)throw Error("replacement target mismatch");const existing=[...this.assignments.values()].find((a)=>a.supersedesArtworkAssignmentId===input.supersedesArtworkAssignmentId);if(existing)return existing;const a:ArtworkAssignment={id:input.id,organizationId:input.organizationId,artworkFileId:input.artworkFileId,orderId:input.usage.orderId,orderLineId:input.usage.orderLineId,purpose:input.usage.purpose,createdAt:"now",supersedesArtworkAssignmentId:input.supersedesArtworkAssignmentId,...(input.usage.side?{side:input.usage.side}:{})};this.assignments.set(a.id,a);return a; }
}
const memory=new MemoryArtworkTransaction(); const runner:ArtworkTransactionRunner={transaction:async(action)=>action(memory)}; const service=new ArtworkApplicationService(runner);

describe("M2.0 Artwork contracts", () => {
  test("one file has customer and production usages without duplication", async () => {
    const adopted=await service.adopt(context("adopt"),input("adopt",{usage:usage({purpose:"customer_supplied"})}));expect(adopted.ok).toBe(true);if(!adopted.ok)return;
    const assigned=await service.assign(context("assign"),{businessRequestId:"assign",artworkFileId:adopted.value.artworkFile.id,usage:usage()});expect(assigned.ok).toBe(true);expect(memory.files.size).toBe(1);expect(memory.assignments.size).toBe(2);
  });
  test("derived file has independent identity and durable lineage", async () => {
    const source=await service.adopt(context("source"),input("source"));if(!source.ok)throw Error("source");
    const derived=await service.derive(context("derive"),{...input("derive",{source:"prepress_derived",usage:usage({side:"back"})}),derivedFromArtworkFileId:source.value.artworkFile.id});expect(derived.ok).toBe(true);if(derived.ok)expect(derived.value.artworkFile.derivedFromArtworkFileId).toBe(source.value.artworkFile.id);
  });
  test("front/back, layers, and pages are independent assignment dimensions", async () => {
    const a=await service.adopt(context("multi"),input("multi",{pageCount:2,usage:usage({side:"front",sourcePageIndex:0,layerKey:"white",layerOrder:0})}));if(!a.ok)throw Error("a");
    await service.assign(context("back"),{businessRequestId:"back",artworkFileId:a.value.artworkFile.id,usage:usage({side:"back",sourcePageIndex:1,layerKey:"ink",layerOrder:1})});expect(memory.assignments.size).toBeGreaterThanOrEqual(4);
  });
  test("identical replay produces one durable assignment and audit", async () => {
    const first=await service.adopt(context("replay"),input("replay"));const second=await service.adopt(context("replay"),input("replay"));expect(first).toEqual(second);expect(memory.auditRows.length).toBeGreaterThan(0);
  });
  test("permission denial occurs before M0 reservation", async () => {
    const denied=new ArtworkApplicationService(runner);const no={...context("no"),principal:{...principal,authority:{...principal.authority,capabilities:[] as const}}};const before=memory.requests.size;const result=await denied.adopt(no,input("no"));expect(result.ok).toBe(false);expect(before).toBe(memory.requests.size);
  });
  test("a customer-scoped Portal delegate can adopt source artwork after the Portal boundary grants artwork.adopt", async () => {
    const portal={kind:"portal" as const,organizationId:org,customerId:"customer-a",subjectId:"portal-user-a",capabilities:["artwork.adopt"] as const};
    const result=await new ArtworkApplicationService(runner).adopt({principal:portal,organizationId:org,operationId:"portal-adopt",businessRequest:{id:"portal-adopt",payloadFingerprint:"portal"}},input("portal-adopt",{usage:usage({purpose:"customer_supplied"})}));
    expect(result.ok).toBe(true);
  });
  test("ordinary uploads append same-purpose, same-side files without superseding an earlier line assignment", async () => {
    const transaction = new MemoryArtworkTransaction();
    const isolated = new ArtworkApplicationService({ transaction: async (action) => action(transaction) });
    const uploads = [
      await isolated.adopt(context("add-a"), input("add-a", { usage: usage({ purpose: "customer_supplied", side: "front" }) })),
      await isolated.adopt(context("add-b"), input("add-b", { usage: usage({ purpose: "customer_supplied", side: "front" }) })),
      await isolated.adopt(context("add-c"), input("add-c", { usage: usage({ purpose: "customer_supplied", side: "front" }) })),
    ];
    expect(uploads.every((result) => result.ok)).toBe(true);
    const current = await isolated.listForOrderLine(context("add-read"), "line");
    expect(current.ok).toBe(true);
    if (!current.ok) return;
    expect(current.value).toHaveLength(3);
    const uploadedFileIds = uploads.flatMap((result) => result.ok ? [result.value.artworkFile.id] : []);
    expect(current.value.map((entry) => entry.assignment.artworkFileId)).toEqual(expect.arrayContaining(uploadedFileIds));
    expect(current.value.every((entry) => entry.assignment.supersedesArtworkAssignmentId === undefined)).toBe(true);
    expect(await isolated.listForOrder(context("order-read"), "order")).toEqual(current);

    const first = uploads[0]!;
    if (!first.ok) throw new Error("First adoption failed");
    const replay = await isolated.adopt(context("add-a"), input("add-a", { usage: usage({ purpose: "customer_supplied", side: "front" }) }));
    expect(replay).toEqual(first);
    expect(transaction.files.size).toBe(3);
    expect(transaction.assignments.size).toBe(3);

    const replacement = await isolated.replace(context("replace-a"), { ...input("replace-a", { usage: usage({ purpose: "customer_supplied", side: "front" }) }), supersedesArtworkAssignmentId: first.value.assignment.id });
    if (!replacement.ok) throw new Error("Explicit replacement failed");
    const after = await isolated.listForOrderLine(context("after-read"), "line");
    if (!after.ok) throw new Error("Current read failed");
    expect(after.value.map((item) => item.assignment.id).sort()).toEqual([
      ...current.value.filter((item) => item.assignment.id !== first.value.assignment.id).map((item) => item.assignment.id),
      replacement.value.assignment.id,
    ].sort());
    expect(await isolated.listForOrder(context("after-order-read"), "order")).toEqual(after);
    expect(transaction.assignments.get(first.value.assignment.id)).toEqual(first.value.assignment);

    await isolated.adopt(context("other-line"), input("other-line", { usage: usage({ purpose: "customer_supplied", orderLineId: brandedId<"OrderLineId">("line-other") }) }));
    expect(await isolated.listForOrderLine(context("isolated-line-read"), "line")).toEqual(after);
    const beforeFailure = transaction.assignments.size;
    const failure = await isolated.adopt(context("invalid"), input("invalid", { usage: usage({ sourcePageIndex: -1 }) }));
    expect(failure.ok).toBe(false);
    expect(transaction.assignments.size).toBe(beforeFailure);
    expect(await isolated.listForOrderLine(context("after-failure-read"), "line")).toEqual(after);
  });
  test("adoption does not grant artwork.assign and foreign tenant scope is rejected before reservation", async () => {
    const transaction = new MemoryArtworkTransaction();
    const isolated = new ArtworkApplicationService({ transaction: async (action) => action(transaction) });
    const adoptOnly = { ...context("adopt-only"), principal: { ...principal, authority: { ...principal.authority, capabilities: ["artwork.adopt"] as const } } };
    const adopted = await isolated.adopt(adoptOnly, input("adopt-only"));
    if (!adopted.ok) throw new Error("Adoption failed");
    const assignContext = { ...adoptOnly, businessRequest: { id: "assign-denied", payloadFingerprint: "test" } };
    const denied = await isolated.assign(assignContext, { businessRequestId: "assign-denied", artworkFileId: adopted.value.artworkFile.id, usage: usage() });
    expect(denied).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    const before = transaction.requests.size;
    const foreign = await isolated.adopt({ ...context("foreign"), organizationId: "other-org" }, input("foreign"));
    expect(foreign.ok).toBe(false);
    expect(transaction.requests.size).toBe(before);
    expect(transaction.assignments.size).toBe(1);
  });
  test("replacement preserves the inherited assignment and appends one current successor", async () => {
    const inherited=await service.adopt(context("inherited"),input("inherited",{usage:usage({purpose:"customer_supplied"})}));if(!inherited.ok)throw Error("inherited");
    const replacement=await service.replace(context("replacement"),{...input("replacement",{usage:usage({purpose:"customer_supplied"})}),supersedesArtworkAssignmentId:inherited.value.assignment.id});
    expect(replacement.ok).toBe(true);if(!replacement.ok)return;
    expect(memory.assignments.get(inherited.value.assignment.id)).toEqual(inherited.value.assignment);
    expect(replacement.value.assignment.supersedesArtworkAssignmentId).toBe(inherited.value.assignment.id);
    const current=await service.listForOrderLine(context("replacement-read"),"line");
    expect(current.ok).toBe(true);if(current.ok)expect(current.value.some((item)=>item.assignment.id===inherited.value.assignment.id)).toBe(false);
  });
});
