import assert from "node:assert/strict";
import { basisPointsToPercentage, homeBusinessTaxSettingsInput, percentageToBasisPoints } from "../../src/modules/sales/taxSettings.js";
import { resolveTaxJurisdiction } from "../../src/modules/sales/taxComposition.js";

assert.equal(percentageToBasisPoints("7"),700);
assert.equal(percentageToBasisPoints("7.25"),725);
assert.equal(basisPointsToPercentage(725),"7.25");
assert.throws(()=>percentageToBasisPoints("7.255"));
assert.throws(()=>percentageToBasisPoints("Infinity"));
assert.throws(()=>percentageToBasisPoints("101"));
assert.deepEqual(homeBusinessTaxSettingsInput({name:"Home",countryCode:"us",regionCode:"in",ratePercent:"7.25",active:true}),{name:"Home",countryCode:"US",regionCode:"IN",rateBasisPoints:725,active:true});
const active=resolveTaxJurisdiction({fulfillment:{method:"pickup"},jurisdictions:[{jurisdictionId:"home",name:"Home",receiptLocation:{country:"US",region:"IN"},rateBasisPoints:725,active:true,homeBusiness:true}]});
assert.equal(active.status,"resolved");
const inactive=resolveTaxJurisdiction({fulfillment:{method:"pickup"},jurisdictions:[{jurisdictionId:"home",name:"Home",receiptLocation:{country:"US",region:"IN"},rateBasisPoints:725,active:false,homeBusiness:true}]});
assert.equal(inactive.status,"unresolved");
console.log("Sales Tax Settings pure tests passed.");
