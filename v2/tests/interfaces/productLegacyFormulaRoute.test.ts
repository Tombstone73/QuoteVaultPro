import express from "express";
import request from "supertest";
import { describe, expect, test } from "@jest/globals";
import { createProductRouter } from "../../src/interfaces/http/productRoutes";
import type { StaffPrincipal } from "../../src/authorization/principals";

const principal=(capabilities:readonly("product.view"|"product.edit")[]):StaffPrincipal=>({kind:"staff",organizationId:"org-a",userId:"staff-a",authority:{membershipId:"membership-a",capabilities}});
const formula={productId:"product-a",draftVersionId:"draft-a",draftUpdatedAt:"2026-08-18T01:00:00.000Z",lifecycle:"draft" as const,source:"embedded_editable" as const,editable:true,expressionEditable:true,variablesEditable:true,rotationEditable:false,inputs:[],expression:"q * p",variables:{p:500},allowRotation:false,supportedRuntimeVariables:["q","p"],warnings:[]};
const app=(actor:StaffPrincipal,adoptLegacyProductFormula:unknown)=>express().use(express.json()).use("/v2/organizations/:organizationId/products",createProductRouter({principals:{principal:async()=>actor},lifecycle:{adoptLegacyProductFormula},publication:{},recipes:{},draftRecipe:{},materials:{},draftGeneral:{},draftOptions:{},draftPricing:{},draftMatrix:{},draftFormula:{},draftOptionPricing:{},draftPreview:{},workspace:{}} as any));

describe("legacy Product Formula adoption route",()=>{
  test("requires product.edit, validates the revision envelope, and never forwards a client formula",async()=>{
    const body={businessRequestId:"legacy-adopt-1",draftVersionId:"draft-a",expectedDraftUpdatedAt:formula.draftUpdatedAt};
    await request(app(principal(["product.view"]),async()=>({ok:true,value:formula}))).post("/v2/organizations/org-a/products/product-a/draft/pricing/formula/adopt-legacy").send(body).expect(403);
    let received:unknown;
    const server=app(principal(["product.view","product.edit"]),async(_context:unknown,input:unknown)=>{received=input;return{ok:true,value:formula};});
    await request(server).post("/v2/organizations/org-a/products/product-a/draft/pricing/formula/adopt-legacy").send({...body,expression:"client supplied"}).expect(200,{ok:true,data:formula});
    expect(received).toEqual({productId:"product-a",...body});
    await request(server).post("/v2/organizations/org-a/products/product-a/draft/pricing/formula/adopt-legacy").send({...body,draftVersionId:null}).expect(400);
  });
});
