import express from "express";
import request from "supertest";
import {describe,expect,test} from "@jest/globals";
import {createPortalInvoiceRouter} from "../../src/interfaces/http/portalInvoiceRoutes";
import {V2ApplicationError} from "../../src/errors/applicationError";
import type {PortalPrincipal} from "../../src/authorization/principals";

const portal:PortalPrincipal={kind:"portal",organizationId:"org-a",portalAccessId:"access-a",customerId:"customer-a",subjectId:"portal-a",authority:{permissionSetIds:["portal-full"],capabilities:["proof.view","proof.respond"],customerCeiling:{customerId:"customer-a",capabilities:["proof.view","proof.respond"]}}};
const proof={proofVersionId:"proof-a",orderNumber:"ORD-1",lineDescription:"Banner",revision:1,issuedAt:"2026-09-03T00:00:00.000Z",status:"awaiting_response",actionable:true,artifacts:[]};
const app=(calls:unknown[]=[])=>express().use(express.json()).use((req,_res,next)=>{(req as any).session={v2CsrfToken:"csrf-proof"};next();}).use("/v2/portal",createPortalInvoiceRouter({
  portalPrincipal:{principal:async()=>portal},proofs:{list:async actor=>{calls.push({kind:"list",actor});return[proof];},get:async(actor,id)=>{calls.push({kind:"get",actor,id});if(id!=="proof-a")throw new V2ApplicationError("NOT_FOUND","Proof was not found.");return proof;},file:async(_actor,_version,file)=>{if(file!=="file-a")throw new V2ApplicationError("NOT_FOUND","Proof file was not found.");return{filename:"proof.pdf",contentType:"application/pdf",bytes:new Uint8Array([37,80,68,70])};}},proofing:{respond:async(context,input)=>{calls.push({kind:"respond",context,input});return{ok:true as const,value:{response:{proofResponseId:"response-a"}}};}},
} as any));

describe("authenticated portal Proof routes",()=>{
  test("lists and reads only through the portal-scoped projection",async()=>{const calls:unknown[]=[];const server=app(calls);await request(server).get("/v2/portal/proofs").expect(200,{ok:true,data:{items:[proof]}});await request(server).get("/v2/portal/proofs/proof-a").expect(200,{ok:true,data:proof});await request(server).get("/v2/portal/proofs/foreign").expect(404);expect(calls).toEqual(expect.arrayContaining([expect.objectContaining({kind:"list",actor:portal}),expect.objectContaining({kind:"get",id:"proof-a"})]));});
  test("streams an authorized exact artifact without exposing storage identity",async()=>{const response=await request(app()).get("/v2/portal/proofs/proof-a/files/file-a").expect(200);expect(response.headers["content-type"]).toMatch(/application\/pdf/u);expect(response.headers["cache-control"]).toBe("private, no-store");});
  test("requires CSRF and binds a direct response to the path version",async()=>{const calls:any[]=[];const server=app(calls);await request(server).post("/v2/portal/proofs/proof-a/respond").send({businessRequestId:"respond-a",outcome:"approved"}).expect(403);await request(server).post("/v2/portal/proofs/proof-a/respond").set("x-v2-csrf-token","csrf-proof").send({businessRequestId:"respond-a",proofVersionId:"forged",outcome:"approved"}).expect(200);expect(calls.find(call=>call.kind==="respond").input).toMatchObject({businessRequestId:"respond-a",proofVersionId:"proof-a",outcome:"approved"});});
});
