import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { AuthorityPolicy } from "../../src/authorization/authorityPolicy.js";
import { createCustomerCommercialRouter, createPortalCustomerCommercialRouter } from "../../src/interfaces/http/customerCommercialRoutes.js";
import { CustomerCommercialApplicationService, CustomerCommercialPricingAdapter, type CustomerCommercialStore } from "../../src/modules/products/customerCommercial.js";
import type { PricingPort, PricingResult } from "../../src/modules/pricing/contracts.js";
import { currencyCode, money } from "../../src/modules/shared/commercialValues.js";

const USD=currencyCode("USD");
const records:any[]=[];
const store:CustomerCommercialStore={
  isEntitled:async(_org,_customer,product)=>product==="product-a",
  resolveAgreement:async()=>null,
  setEntitlement:async(value)=>{records.push(value);return value;},
  replaceAgreement:async(value)=>({ ...value,id:"agreement-a",active:true,createdAt:"2026-09-07T00:00:00.000Z" }),
  listEntitlements:async()=>records,
  listActivePricingAgreements:async()=>[],
};
const service=new CustomerCommercialApplicationService(store,new AuthorityPolicy());
const staff:any={kind:"staff",organizationId:"org-a",userId:"staff-a",authority:{membershipId:"member-a",capabilities:["product.edit","product.view","pricing.configure"]}};
const base:PricingResult={schemaVersion:1,id:"base" as any,evidenceFingerprint:"base",organizationId:"org-a" as any,currency:USD,calculatedUnitAmount:money(USD,100),calculatedLineAmount:money(USD,200),unitAmountEvidence:{exactUnitCents:"100" as any,allocation:"rounded_line_total_divided_by_quantity"},components:[{kind:"base",label:"base",amount:money(USD,200)}],optionImpacts:[],minimumChargeApplied:false,evaluator:{id:"test",version:"1"},rounding:{policyId:"test",policyVersion:"1",stages:[{stage:"final",mode:"half-up",precision:0}]},normalizedInput:{schemaVersion:1,organizationId:"org-a" as any,productId:"product-a" as any,pricingConfigurationId:"version-a" as any,pricingConfigurationVersion:"1",pricingConfigurationContentHash:"hash",quantity:2,selections:{},derivedFacts:{},productFacts:{}},warnings:[]};
const pricing=new CustomerCommercialPricingAdapter({calculate:async()=>base} satisfies PricingPort,store);
const products:any={getSellableProduct:async(_org:string,product:string)=>product==="product-a"?{organizationId:"org-a",productId:"product-a",displayName:"Allowed Product",lifecycle:"active",pricingConfiguration:{id:"version-a",version:"1",contentHash:"hash"},requiresDimensions:false,pricingCurrency:USD}:null,resolveActivePricingInput:async(input:any)=>({ok:true,value:{sellableProduct:{organizationId:"org-a",productId:input.productId,displayName:"Product",lifecycle:"active",pricingConfiguration:{id:"version-a",version:"1",contentHash:"hash"},requiresDimensions:false,pricingCurrency:USD},resolvedConfiguration:{...base.normalizedInput,productId:input.productId},rules:{},warnings:[]}})};
const staffApp=express().use(express.json()).use("/v2/organizations/:organizationId/customer-commercial",createCustomerCommercialRouter({service,store,pricing,products,principals:{principal:async()=>staff}}));
await request(staffApp).put("/v2/organizations/org-a/customer-commercial/customers/customer-a/products/product-a/entitlement").send({enabled:true}).expect(200);
assert.equal(records[0]?.customerId,"customer-a");
await request(staffApp).put("/v2/organizations/org-a/customer-commercial/customers/customer-a/products/product-a/pricing-agreement").send({mode:"fixed_unit",value:125,currency:"USD"}).expect(200);
await request(staffApp).get("/v2/organizations/org-a/customer-commercial/customers/customer-a/pricing-agreements").expect(200,{ok:true,data:[]});
const portal:any={kind:"portal",organizationId:"org-a",customerId:"customer-a",subjectId:"portal-a",capabilities:["product.view"]};
const portalApp=express().use(express.json()).use("/v2/portal/catalog",createPortalCustomerCommercialRouter({service,store,pricing,products,portalPrincipal:{principal:async()=>portal}}));
await request(portalApp).get("/v2/portal/catalog").expect(200,{ok:true,data:{items:[{productId:"product-a",displayName:"Allowed Product",requiresDimensions:false,currency:"USD"}]}});
await request(portalApp).post("/v2/portal/catalog/product-b/price-preview").send({quantity:2}).expect(403);
await request(portalApp).post("/v2/portal/catalog/product-a/price-preview").send({quantity:2}).expect(200);
console.log("Customer commercial HTTP scope tests passed.");
