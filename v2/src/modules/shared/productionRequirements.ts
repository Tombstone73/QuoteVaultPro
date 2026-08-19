import { createHash } from "node:crypto";
import { canonicalJson, type JsonValue } from "./commercialValues.js";
import type { ArtworkSide } from "../artwork/contracts.js";

export type ProductionUnitRequirement = Readonly<{ key:string; side?:ArtworkSide; sourcePageIndex?:number; layerKey?:string; layerOrder?:number }>;
export type ProductionRequirementSnapshot =
  | Readonly<{ state:"configured"; specificationFingerprint:string; units:readonly ProductionUnitRequirement[] }>
  | Readonly<{ state:"unconfigured"; reason:"product_specification_absent" }>;
export type ProductionUnitRule = Readonly<{ key:string; side?:ArtworkSide; sourcePageIndex?:number; layerKey?:string; layerOrder?:number; when?:Readonly<{ selectionKey:string; equals:string|number|boolean }> }>;
export type ProductionUnitSpecification = Readonly<{ schemaVersion:1; rules:readonly ProductionUnitRule[] }>;

const object=(value:unknown):Record<string,unknown>|null=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;
const validKey=(value:string)=>/^[a-z][a-z0-9_.:-]{0,119}$/u.test(value);
const scalar=(value:unknown):value is string|number|boolean=>typeof value==="string"||typeof value==="number"||typeof value==="boolean";
const equal=(a:JsonValue|undefined,b:string|number|boolean)=>Array.isArray(a)?a.includes(b):a===b;

/** Validates version-owned Product authoring before it becomes Draft truth. */
export const validateProductionUnitSpecification=(value:unknown):ProductionUnitSpecification=>{
  const raw=object(value); if(!raw||raw.schemaVersion!==1||!Array.isArray(raw.rules))throw Error("Production-unit specification must be schema version 1 with rules.");
  const keys=new Set<string>();
  const rules=raw.rules.map((candidate):ProductionUnitRule=>{
    const rule=object(candidate); if(!rule||typeof rule.key!=="string"||!validKey(rule.key))throw Error("Production-unit requirement key is invalid."); if(keys.has(rule.key))throw Error("Production-unit requirements cannot contain duplicate keys.");
    keys.add(rule.key);
    if(rule.side!==undefined&&rule.side!=="front"&&rule.side!=="back")throw Error("Production-unit requirement side is invalid.");
    if(rule.sourcePageIndex!==undefined&&(!Number.isInteger(rule.sourcePageIndex)||Number(rule.sourcePageIndex)<0))throw Error("Production-unit requirement page is invalid.");
    if((rule.layerKey===undefined)!==(rule.layerOrder===undefined)||rule.layerKey!==undefined&&(typeof rule.layerKey!=="string"||!rule.layerKey.trim()||!Number.isInteger(rule.layerOrder)||Number(rule.layerOrder)<0))throw Error("Production-unit requirement layer is invalid.");
    const when=rule.when===undefined?undefined:object(rule.when); if(when&&(typeof when.selectionKey!=="string"||!when.selectionKey.trim()||!scalar(when.equals)))throw Error("Production-unit requirement condition is invalid.");
    return {key:rule.key,...(rule.side?{side:rule.side as ArtworkSide}:{}),...(rule.sourcePageIndex===undefined?{}:{sourcePageIndex:Number(rule.sourcePageIndex)}),...(rule.layerKey===undefined?{}:{layerKey:rule.layerKey.trim(),layerOrder:Number(rule.layerOrder)}),...(when?{when:{selectionKey:String(when.selectionKey).trim(),equals:when.equals as string|number|boolean}}:{})};
  }).sort((a,b)=>a.key.localeCompare(b.key));
  return {schemaVersion:1,rules};
};

/** Product/PBV2 policy resolver. It reads only configured product truth, never Artwork or Prepress. */
export const resolveProductionRequirementSnapshot=(value:unknown,selections:Readonly<Record<string,JsonValue>>):ProductionRequirementSnapshot=>{
  if(value===undefined||value===null)return {state:"unconfigured",reason:"product_specification_absent"};
  const specification=validateProductionUnitSpecification(value);
  const units:ProductionUnitRequirement[]=[];
  for(const rule of specification.rules){
    const condition=rule.when;
    if(condition&&!equal(selections[condition.selectionKey],condition.equals))continue;
    units.push({key:rule.key,...(rule.side?{side:rule.side as ArtworkSide}:{}),...(rule.sourcePageIndex===undefined?{}:{sourcePageIndex:Number(rule.sourcePageIndex)}),...(rule.layerKey===undefined?{}:{layerKey:rule.layerKey as string,layerOrder:Number(rule.layerOrder)})});
  }
  if(new Set(units.map((unit)=>unit.key)).size!==units.length)throw Error("Configured production-unit requirements have duplicate keys.");
  const ordered=units.sort((a,b)=>a.key.localeCompare(b.key));
  // A line's freeze must change when selections alter the effective set even
  // though the Product/PBV2 specification itself is unchanged.
  return {state:"configured",specificationFingerprint:`sha256:${createHash("sha256").update(canonicalJson({specification,units:ordered})).digest("hex")}`,units:ordered};
};

export const productionRequirementSnapshot=(value:unknown):ProductionRequirementSnapshot=>{
  const raw=object(value); if(!raw)return {state:"unconfigured",reason:"product_specification_absent"};
  if(raw.state==="unconfigured")return {state:"unconfigured",reason:"product_specification_absent"};
  if(raw.state!=="configured"||typeof raw.specificationFingerprint!=="string"||!Array.isArray(raw.units))throw Error("Frozen production requirements are invalid.");
  if(!/^sha256:[A-Fa-f0-9]{64}$/u.test(raw.specificationFingerprint))throw Error("Frozen production requirement fingerprint is invalid.");
  const validated=resolveProductionRequirementSnapshot({schemaVersion:1,rules:raw.units},{});
  if(validated.state!=="configured")throw Error("Frozen production requirements are invalid.");
  return {state:"configured",specificationFingerprint:raw.specificationFingerprint,units:validated.units};
};
