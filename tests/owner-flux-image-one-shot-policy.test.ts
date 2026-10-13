import assert from "node:assert/strict";
import test from "node:test";
import { createOwnerFluxImageAssetBindingIssuer, prepareOwnerFluxImageRequest, type OwnerFluxAssetResolverContext } from "../src/application/owner-flux-image-request-preparer.js";
import { createOwnerFluxImageOneShotPermit, consumeOwnerFluxImageOneShotPermit } from "../src/application/owner-flux-image-one-shot-policy.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const catalog=loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const catalog_version=DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const BASE=Date.parse("2026-10-10T00:00:00.000Z");
const principal=Object.freeze({tenant_id:"tenant_test",subject_id:"subject_test",connection_id:"link_test_0123456789abcdef"});
let clock=BASE;
async function makeCandidate(){
  const issuer=createOwnerFluxImageAssetBindingIssuer({
    async resolveImage(c:Readonly<OwnerFluxAssetResolverContext>){return {...c,provenance:"private_r2_owned",provenance_verified:true,asset_id:"image-1",canonical_url:"https://r2.syntx.ai/private/flux/image.png",mime_type:"image/png",width:400,height:300,size:90,sha256:`sha256:${"1".repeat(64)}`,expires_at:BASE+600_000};},
    async resolveLora(c:Readonly<OwnerFluxAssetResolverContext>){return {...c,provenance:"public_civitai_verified",provenance_verified:true,asset_id:"900",canonical_url:"https://civitai.com/api/download/models/900",size:100,sha256:`sha256:${"2".repeat(64)}`,expires_at:BASE+600_000};}
  },{catalog,catalog_version,now:()=>clock});
  const set=await issuer.issue({principal,attempt_id:principal.connection_id,model_id:"flux-1",image_reference_handle:"flux_image_00000000-0000-4000-8000-000000000001",lora_references:[]});
  const candidate=prepareOwnerFluxImageRequest({principal,attempt_id:principal.connection_id,model_id:"flux-1",asset_set:set,prompt:"once",parameters:{resolution:"1024x1024",cfg:2.5,steps:17.5,image_strength:0.5,workflow_type:"default",raw:null,civitai_loras:[]}}, {catalog,catalog_version,now:()=>clock});
  return {issuer,candidate};
}

test("a Flux one-shot permit binds a candidate and consumes exactly once",async()=>{
  clock=BASE;const {issuer,candidate}=await makeCandidate();
  const permit=createOwnerFluxImageOneShotPermit({candidate,principal,attemptId:principal.connection_id,catalog,catalog_version,now:()=>clock});
  assert.equal(permit.dispatch_allowed,false);
  assert.equal(consumeOwnerFluxImageOneShotPermit({permit,candidate,principal,attemptId:principal.connection_id}).status,"consumed");
  assert.throws(()=>consumeOwnerFluxImageOneShotPermit({permit,candidate,principal,attemptId:principal.connection_id}),(e:unknown)=>(e as {code?:string}).code==="PERMIT_ALREADY_CONSUMED");
  issuer.close();
});

test("permit rejects principal/clone mismatch, invalidation, expiration, and backward clock",async()=>{
  clock=BASE;const first=await makeCandidate();const permit=createOwnerFluxImageOneShotPermit({candidate:first.candidate,principal,attemptId:principal.connection_id,catalog,catalog_version,now:()=>clock});
  const other={...principal,subject_id:"other"};assert.throws(()=>consumeOwnerFluxImageOneShotPermit({permit,candidate:first.candidate,principal:other,attemptId:principal.connection_id}));
  assert.throws(()=>consumeOwnerFluxImageOneShotPermit({permit,candidate:Object.freeze({...first.candidate}),principal,attemptId:principal.connection_id}));
  first.issuer.invalidateAttempt(principal.connection_id);assert.throws(()=>consumeOwnerFluxImageOneShotPermit({permit,candidate:first.candidate,principal,attemptId:principal.connection_id}));first.issuer.close();
  clock=BASE;const second=await makeCandidate();const expiring=createOwnerFluxImageOneShotPermit({candidate:second.candidate,principal,attemptId:principal.connection_id,catalog,catalog_version,now:()=>clock});
  clock=BASE+15*60_000;assert.throws(()=>consumeOwnerFluxImageOneShotPermit({permit:expiring,candidate:second.candidate,principal,attemptId:principal.connection_id}));second.issuer.close();
  clock=BASE;const third=await makeCandidate();const backwards=createOwnerFluxImageOneShotPermit({candidate:third.candidate,principal,attemptId:principal.connection_id,catalog,catalog_version,now:()=>clock});
  clock=BASE-1;assert.throws(()=>consumeOwnerFluxImageOneShotPermit({permit:backwards,candidate:third.candidate,principal,attemptId:principal.connection_id}));third.issuer.close();
});
