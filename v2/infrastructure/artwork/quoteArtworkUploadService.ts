import { createHash } from "node:crypto";
import type { OperationContext } from "../../src/application/operation.js";
import { failure, type ApplicationResult, V2ApplicationError } from "../../src/errors/applicationError.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";
import { QuoteArtworkApplicationService, type QuoteArtworkMutationResult } from "../../src/modules/artwork/quoteArtworkApplication.js";
import type { ArtworkPurpose, ArtworkSide } from "../../src/modules/artwork/contracts.js";
import type { ArtworkBinaryStorage } from "./artworkBinaryStorage.js";

export type QuoteArtworkUploadInput = Readonly<{ businessRequestId:string; expectedRevision:string; quoteId:string; quoteLineId:string; purpose:ArtworkPurpose; side?:ArtworkSide; sourcePageIndex?:number; layerKey?:string; layerOrder?:number; filename:string; contentType:string; bytes:Buffer }>;
const max = 10 * 1024 * 1024;
const filename = (value:string) => { const clean=value.replace(/[\\/]/gu,"_").replace(/[^A-Za-z0-9._ -]/gu,"_").replace(/\s+/gu," ").trim(); if(!clean||clean.length>120)throw new V2ApplicationError("VALIDATION_ERROR","Artwork filename is invalid.");return clean; };

/** Same private PDF ingestion path as Order artwork; only the business association differs. */
export class QuoteArtworkUploadService {
  constructor(private readonly artwork:QuoteArtworkApplicationService,private readonly storage:ArtworkBinaryStorage) {}
  async upload(context:OperationContext,input:QuoteArtworkUploadInput):Promise<ApplicationResult<QuoteArtworkMutationResult>> {
    try {
      const display=filename(input.filename);
      if(!input.businessRequestId.trim()||!input.expectedRevision.trim())throw new V2ApplicationError("VALIDATION_ERROR","businessRequestId and expectedRevision are required.");
      if(!["customer_supplied","production","proof","reference"].includes(input.purpose)|| (input.side!==undefined&&input.side!=="front"&&input.side!=="back"))throw new V2ApplicationError("VALIDATION_ERROR","Artwork usage is invalid.");
      if(!input.bytes.length||input.bytes.length>max||input.contentType!=="application/pdf"||input.bytes.subarray(0,5).toString("ascii")!=="%PDF-")throw new V2ApplicationError("VALIDATION_ERROR","Only valid PDF Artwork files up to 10 MB are supported.");
      const checksum=createHash("sha256").update(input.bytes).digest("hex"); const objectKey=`v2-artwork/${context.organizationId}/${checksum}.pdf`;
      const stored=await this.storage.put({organizationId:context.organizationId,objectKey,contentType:input.contentType,bytes:input.bytes});
      const result=await this.artwork.adopt(context,{businessRequestId:input.businessRequestId,expectedRevision:input.expectedRevision,objectReference:{storageProvider:stored.storageProvider,objectKey:stored.objectKey},originalFilename:display,displayFilename:display,contentType:input.contentType,byteSize:input.bytes.length,checksum:{algorithm:"sha256",value:checksum},source:"customer_upload",usage:{quoteId:brandedId<"QuoteId">(input.quoteId),quoteLineId:brandedId<"SalesLineId">(input.quoteLineId),purpose:input.purpose,...(input.side?{side:input.side}:{}),...(input.sourcePageIndex!==undefined?{sourcePageIndex:input.sourcePageIndex}:{}),...(input.layerKey!==undefined?{layerKey:input.layerKey,layerOrder:input.layerOrder!}:{})}});
      if(!result.ok&&stored.created)await this.storage.remove(stored.objectKey).catch(()=>undefined);
      return result;
    } catch(cause) { return failure(cause instanceof V2ApplicationError?cause:new V2ApplicationError("RETRYABLE_FAILURE","Artwork storage is unavailable.")); }
  }
}
