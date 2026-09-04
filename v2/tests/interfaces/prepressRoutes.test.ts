import express from "express";
import request from "supertest";
import { describe, expect, test } from "@jest/globals";
import { createPrepressRouter, type PrepressHttpDependencies } from "../../src/interfaces/http/prepressRoutes";
import type { StaffPrincipal } from "../../src/authorization/principals";
import { V2ApplicationError } from "../../src/errors/applicationError";

const principal = (organizationId:string):StaffPrincipal => ({kind:"staff",organizationId,userId:"staff-a",authority:{membershipId:"membership-a",capabilities:["prepress.view","prepress.work","prepress.complete"]}});
const unit = {prepressUnitId:"unit-a",organizationId:"org-a",orderId:"order-a",orderLineId:"line-a",artworkAssignmentId:"assignment-a",artworkFileId:"file-a",side:"front",createdAt:"2026-08-25T00:00:00.000Z",createdPrincipalKind:"staff",createdPrincipalSubject:"staff-a"};

const app = (actor:StaffPrincipal,calls:unknown[]=[]) => express().use(express.json()).use("/v2/organizations/:organizationId/prepress",createPrepressRouter({principals:{principal:async(_request,organizationId)=>{if(organizationId!==actor.organizationId)throw new V2ApplicationError("WRONG_TENANT","Foreign tenant.");return actor;}},service:{getUnit:async(context,id)=>{calls.push({kind:"get",context,id});return id==="unit-a"?{ok:true as const,value:unit}:{ok:false as const,error:new V2ApplicationError("NOT_FOUND","Prepress unit was not found.")};},listQueue:async(context,page)=>{calls.push({kind:"list",context,page});return{ok:true as const,value:{items:[],pagination:{page:page?.page??1,pageSize:25 as const,totalCount:0,totalPages:0}}};},getOrderLineCoverage:async()=>({ok:true as const,value:{state:"unconfigured",requirements:[],productionArtworkComplete:false,allRequiredPrepressUnitsComplete:false}}),listOrderLineUnits:async()=>({ok:true as const,value:[]}),open:async()=>({ok:true as const,value:{unit}}),start:async()=>({ok:true as const,value:{unit}}),complete:async()=>({ok:true as const,value:{unit}})}} satisfies PrepressHttpDependencies));

describe("Prepress HTTP transport",()=>{
  test("pages and searches the tenant queue before selecting records",async()=>{const calls:any[]=[];const server=app(principal("org-a"),calls);await request(server).get("/v2/organizations/org-a/prepress/queue?page=3&pageSize=50&q=Acme").expect(200);expect(calls.find(call=>call.kind==="list")).toMatchObject({page:{page:3,pageSize:50,search:"Acme"}});});
  test("serves a tenant-scoped canonical unit detail for safe deep links",async()=>{
    const calls:unknown[]=[];const server=app(principal("org-a"),calls);
    await request(server).get("/v2/organizations/org-a/prepress/units/unit-a").expect(200,{ok:true,data:unit});
    expect(calls).toEqual([expect.objectContaining({kind:"get",id:"unit-a",context:expect.objectContaining({organizationId:"org-a"})})]);
  });
  test("returns the ordinary not-found envelope for unavailable or foreign units",async()=>{
    const server=app(principal("org-a"));
    await request(server).get("/v2/organizations/org-a/prepress/units/missing").expect(404,{ok:false,error:{code:"NOT_FOUND",message:"Prepress unit was not found."}});
    await request(server).get("/v2/organizations/org-b/prepress/units/unit-a").expect(404,{ok:false,error:{code:"WRONG_TENANT",message:"Foreign tenant."}});
  });
});
