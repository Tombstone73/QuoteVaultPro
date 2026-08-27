import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { createTaxSettingsRouter, type TaxSettingsHttpDependencies } from "../../src/interfaces/http/taxSettingsRoutes.js";
import type { StaffPrincipal } from "../../src/authorization/principals.js";

const staff=(organizationId="org-a",capabilities=["pricing.configure"]):StaffPrincipal=>({kind:"staff",organizationId,userId:"staff-a",authority:{membershipId:"membership-a",capabilities}});
const settings={homeBusiness:{jurisdictionId:"tax-a",name:"Indiana",countryCode:"US",regionCode:"IN",rateBasisPoints:725,active:true,homeBusiness:true,updatedAt:"2026-01-01T00:00:00.000Z"}};
const calls:unknown[]=[];
const app=(actor:StaffPrincipal)=>express().use(express.json()).use("/v2/organizations/:organizationId/settings/sales-tax",createTaxSettingsRouter({principals:{principal:async()=>actor},settings:{read:async()=>settings,save:async(org,input,principal,id)=>{calls.push({org,input,principal:principal.organizationId,id});return settings;}}} satisfies TaxSettingsHttpDependencies));
await request(app(staff())).get("/v2/organizations/org-a/settings/sales-tax").expect(200,{ok:true,data:settings});
await request(app(staff())).put("/v2/organizations/org-a/settings/sales-tax/home-business").send({businessRequestId:"tax-save-a",name:" Indiana ",countryCode:"us",regionCode:"in",ratePercent:"7.25",active:true,organizationId:"org-b"}).expect(200,{ok:true,data:settings});
assert.deepEqual(calls,[{org:"org-a",input:{name:"Indiana",countryCode:"US",regionCode:"IN",rateBasisPoints:725,active:true},principal:"org-a",id:"tax-save-a"}]);
await request(app(staff())).put("/v2/organizations/org-a/settings/sales-tax/home-business").send({businessRequestId:"bad",name:"Indiana",countryCode:"US",regionCode:"IN",ratePercent:"7.255",active:true}).expect(400);
await request(app(staff("org-a",[]))).get("/v2/organizations/org-a/settings/sales-tax").expect(403);
await request(app(staff("org-b"))).put("/v2/organizations/org-a/settings/sales-tax/home-business").send({businessRequestId:"foreign",name:"Indiana",countryCode:"US",regionCode:"IN",ratePercent:"7",active:true}).expect(403);
console.log("Sales Tax settings HTTP scope and validation tests passed.");
