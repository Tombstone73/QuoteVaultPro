import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { createTeamAccessRouter } from "../../src/interfaces/http/teamAccessRoutes.js";

const actor={kind:"staff" as const,organizationId:"org-a",userId:"staff-a",authority:{membershipId:"membership-a",source:"permission_set" as const,authorityRevision:"7",capabilities:["permissions.view","permissions.manageSets","permissions.assignStaff","permissions.assignPortal"] as const}};
const snapshot={authorityRevision:"7",staff:[{memberId:"staff-a",status:"active"}],invitations:[],permissionSets:[],portalAccess:[],portalCandidates:[],audit:[],readiness:{status:"ready" as const,reasons:[],activeStaffCount:1,viableAdministratorCount:1,pendingInvitationCount:0},capabilityGroups:[]};
const app=(principal=actor)=>{const calls:string[]=[];const team:any={read:async()=>snapshot,createInvitation:async()=>{calls.push("invite");return{invitationId:"invite-a",status:"pending" as const};},bootstrapPortalAccess:async()=>{calls.push("portal-bootstrap");return{portalAccessId:"portal-a",status:"pending",deliveryState:"succeeded"};},setMembershipActive:async()=>{calls.push("status");},replaceStaffAssignments:async()=>{calls.push("staff-sets");},replacePortalAssignments:async()=>{calls.push("portal-sets");},createCustomSet:async()=>{calls.push("create-set");return{permissionSetId:"set-a"};},updateCustomSet:async()=>{calls.push("update-set");}};const value=express();value.use(express.json());value.use("/v2/organizations/:organizationId/settings/team-access",createTeamAccessRouter({teamAccess:team,principals:{principal:async()=>principal} as any}));return{value,calls};};

{
  const {value}=app(); const response=await request(value).get("/v2/organizations/org-a/settings/team-access/staff").expect(200);assert.equal(response.body.ok,true);assert.equal(response.body.data.authorityRevision,"7");
}
{
  const {value,calls}=app();await request(value).post("/v2/organizations/org-a/settings/team-access/permission-sets").send({businessRequestId:"set-create",expectedAuthorityRevision:"7",name:"Dispatch",capabilities:["permissions.view"]}).expect(201);assert.deepEqual(calls,["create-set"]);
}
{
  const weak={...actor,authority:{...actor.authority,capabilities:["permissions.view"] as const}};const {value,calls}=app(weak);await request(value).patch("/v2/organizations/org-a/settings/team-access/staff/staff-b/status").send({businessRequestId:"disable",expectedAuthorityRevision:"7",active:false}).expect(403);assert.deepEqual(calls,[]);
}
{
  const {value,calls}=app();await request(value).put("/v2/organizations/org-a/settings/team-access/portal-access/portal-a/permission-sets").send({businessRequestId:"portal",expectedAuthorityRevision:"7",permissionSetIds:["portal-set"]}).expect(200);assert.deepEqual(calls,["portal-sets"]);
}
{
  const {value,calls}=app();await request(value).post("/v2/organizations/org-a/settings/team-access/portal-access/bootstrap").send({businessRequestId:"portal-bootstrap",expectedAuthorityRevision:"7",customerId:"customer-a",contactId:"contact-a",permissionSetId:"portal-set"}).expect(201);assert.deepEqual(calls,["portal-bootstrap"]);
}
console.log("team access HTTP pure contracts passed");
