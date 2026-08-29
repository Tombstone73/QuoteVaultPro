import { describe, expect, test } from "@jest/globals";
import { QuoteArtworkApplicationService, type QuoteArtworkTransaction, type QuoteArtworkTransactionRunner } from "../../src/modules/artwork/quoteArtworkApplication";
import { brandedId } from "../../src/modules/shared/commercialValues";

const org = "quote-art-org";
const principal = { kind:"staff" as const, organizationId:org, userId:"staff", authority:{membershipId:"member",capabilities:["quote.view","quote.edit","artwork.adopt","artwork.assign"] as const} };
const context = (id:string) => ({ organizationId:org, operationId:id, businessRequest:{id,payloadFingerprint:"test"}, principal });
const usage = () => ({ quoteId:brandedId<"QuoteId">("quote-a"),quoteLineId:brandedId<"SalesLineId">("line-a"),purpose:"customer_supplied" as const,side:"front" as const });
const input = (id:string, over:object={}) => ({ businessRequestId:id,expectedRevision:"1",objectReference:{storageProvider:"test",objectKey:`v2-artwork/${org}/${id}.pdf`},originalFilename:"qa.pdf",contentType:"application/pdf",byteSize:8,source:"customer_upload" as const,usage:usage(),...over });

class MemoryQuoteArtworkTransaction implements QuoteArtworkTransaction {
  readonly files=new Map<string,any>(); readonly assignments=new Map<string,any>(); readonly requests=new Map<string,unknown>(); revision="1"; locked=0;
  async reserve(v:any){return this.requests.has(v.businessRequestId)?{kind:"replay" as const,request:{id:v.businessRequestId,resultJson:this.requests.get(v.businessRequestId)}}:{kind:"new" as const,request:{id:v.businessRequestId,resultJson:null}};}
  async succeed(_o:string,id:string,result:unknown){this.requests.set(id,result);} async audit(){ }
  async lockEditableQuote(_o:any,_q:any,revision:string){this.locked++;if(revision!==this.revision)throw Object.assign(new Error("stale"),{code:"STALE_STATE"});}
  async bumpQuoteRevision(_o:any,_q:any,revision:string){if(revision!==this.revision)throw Error("stale");this.revision=String(Number(this.revision)+1);return this.revision;}
  async findFile(_o:any,id:any){return this.files.get(id)??null;}
  async createOrGetFile(v:any){const existing=[...this.files.values()].find((f:any)=>f.objectReference.objectKey===v.file.objectReference.objectKey);if(existing)return existing;const f={id:v.id,organizationId:v.organizationId,objectReference:v.file.objectReference,originalFilename:v.file.originalFilename,displayFilename:v.file.displayFilename??v.file.originalFilename,contentType:v.file.contentType,byteSize:v.file.byteSize,source:v.file.source,createdAt:"now"};this.files.set(f.id,f);return f;}
  async createOrGetAssignment(v:any){const old=[...this.assignments.values()].find((a:any)=>a.quoteLineId===v.usage.quoteLineId&&a.side===v.usage.side);if(old)return old;const a={id:v.id,organizationId:v.organizationId,quoteId:v.usage.quoteId,quoteLineId:v.usage.quoteLineId,artworkFileId:v.artworkFileId,purpose:v.usage.purpose,side:v.usage.side,createdAt:"now"};this.assignments.set(a.id,a);return a;}
  async list(_o:any,quote:any){return [...this.assignments.values()].filter((a:any)=>a.quoteId===quote).map((a:any)=>({assignment:a,file:this.files.get(a.artworkFileId)}));}
  async remove(_o:any,_q:any,id:any){return this.assignments.delete(id);}
}
const memory=new MemoryQuoteArtworkTransaction(); const service=new QuoteArtworkApplicationService({transaction:async(action)=>action(memory)} satisfies QuoteArtworkTransactionRunner);

describe("Quote artwork contracts",()=>{
  test("adopts a canonical file only for a mutable Quote line, advances its stale token, and replays safely",async()=>{
    const first=await service.adopt(context("quote-art-1"),input("quote-art-1"));expect(first.ok).toBe(true);if(!first.ok)return;expect(first.value.quoteRevision).toBe("2");expect(memory.files.size).toBe(1);
    const replay=await service.adopt(context("quote-art-1"),input("quote-art-1"));expect(replay).toEqual(first);expect(memory.assignments.size).toBe(1);
  });
  test("does not allow Quote source evidence to pre-authorize production work",async()=>{
    const result=await service.adopt(context("quote-art-production"),input("quote-art-production",{expectedRevision:memory.revision,usage:{...usage(),purpose:"production"}}));expect(result.ok).toBe(false);if(!result.ok)expect(result.error.code).toBe("VALIDATION_ERROR");
  });
  test("rejects stale Quote artwork mutation before a new file is adopted",async()=>{
    const before=memory.files.size;const result=await service.adopt(context("quote-art-stale"),input("quote-art-stale",{expectedRevision:"1"}));expect(result.ok).toBe(false);expect(memory.files.size).toBe(before);
  });
});
