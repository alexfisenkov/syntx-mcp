import assert from "node:assert/strict";
import test from "node:test";
import {
  createOwnerFluxImageAssetBindingIssuer, isOwnerFluxImagePreparedCandidateForPrincipal, prepareOwnerFluxImageRequest,
  type OwnerFluxAssetResolverContext
} from "../src/application/owner-flux-image-request-preparer.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const catalog=loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const VERSION=DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const BASE=Date.parse("2026-10-10T00:00:00.000Z");
const PRINCIPAL=Object.freeze({tenant_id:"tenant_test",subject_id:"subject_test",connection_id:"link_test_0123456789abcdef"});
const IMAGE="flux_image_00000000-0000-4000-8000-000000000001";
const LORAS=["flux_lora_00000000-0000-4000-8000-000000000001","flux_lora_00000000-0000-4000-8000-000000000002","flux_lora_00000000-0000-4000-8000-000000000003"];
let clock=BASE;
const options={catalog,catalog_version:VERSION,now:()=>clock};
function resolvers(overrides:Record<string,unknown>={}){
  return {
    async resolveImage(c:Readonly<OwnerFluxAssetResolverContext>){return {...c,provenance:"private_r2_owned",provenance_verified:true,asset_id:"image-1",canonical_url:"https://r2.syntx.ai/private/flux/image-1.png",mime_type:"image/png",width:1200,height:800,size:2048,sha256:`sha256:${"1".repeat(64)}`,expires_at:BASE+600_000,...overrides};},
    async resolveLora(c:Readonly<OwnerFluxAssetResolverContext>){const n=LORAS.indexOf(c.asset_handle);return {...c,provenance:"public_civitai_verified",provenance_verified:true,asset_id:String(900+n),canonical_url:`https://civitai.com/api/download/models/${900+n}?format=SafeTensor`,size:3000+n,sha256:`sha256:${String(n+2).repeat(64)}`,expires_at:BASE+600_000,...overrides};}
  };
}
const issueInput=(model_id:"flux-1"|"flux-pro-1.1"|"flux-pro-1.1-ultra",image_reference_handle?:string,lora_references:readonly {handle:string;strength_model:number;strength_clip:number}[]=[])=>(
  {principal:PRINCIPAL,attempt_id:PRINCIPAL.connection_id,model_id,...(image_reference_handle?{image_reference_handle}:{}),lora_references});
function parameters(model_id:"flux-1"|"flux-pro-1.1"|"flux-pro-1.1-ultra",loras:readonly {handle:string;strength_model:number;strength_clip:number}[]=[]){return {
  resolution:model_id==="flux-1"?"1024x1024":model_id==="flux-pro-1.1"?"1152x896":"2048x2048",cfg:2.375,steps:17.25,image_strength:0.625,
  workflow_type:loras.length?"civitai":"default",raw:model_id==="flux-pro-1.1-ultra"?false:null,civitai_loras:loras};}

test("all three Flux variants retain every literal resolution and fractional source control",async()=>{
  clock=BASE;
  const cases=[
    ["flux-1",["1344x768","1216x832","1152x896","1280x1024","1024x1024","1024x1280","896x1152","832x1216","768x1344"],IMAGE] as const,
    ["flux-pro-1.1",["1152x896","1280x1024"],undefined] as const,
    ["flux-pro-1.1-ultra",["3136x1344","2752x1536","2368x1792","2048x2048","1792x2368","1536x2752","1344x3136"],undefined] as const
  ];
  for(const [model,resolutions,image] of cases) for(const resolution of resolutions){
    const issuer=createOwnerFluxImageAssetBindingIssuer(resolvers(),options);
    const set=await issuer.issue(issueInput(model,image));
    const supplied={...parameters(model),resolution};
    const candidate=prepareOwnerFluxImageRequest({principal:PRINCIPAL,attempt_id:PRINCIPAL.connection_id,model_id:model,parameters:supplied,asset_set:set,prompt:"literal fractional source intent"},options);
    assert.equal(candidate.parameters.resolution,resolution);assert.equal(candidate.parameters.cfg,2.375);assert.equal(candidate.parameters.steps,17.25);assert.equal(candidate.parameters.image_strength,0.625);
    assert.equal(candidate.request.settings.n,1);assert.equal(candidate.dispatch_allowed,false);assert.equal(candidate.backend_acceptance,"UNPROVEN");assert.equal(Object.keys(candidate.cost_inputs).length,0);
    assert.equal(candidate.reference_count,image?1:0);assert.equal(JSON.stringify(candidate).includes("r2.syntx.ai"),false);assert.equal(isOwnerFluxImagePreparedCandidateForPrincipal(candidate,PRINCIPAL,PRINCIPAL.connection_id,BASE),true);
    issuer.close();
  }
});

test("all zero to three LoRAs bind exact resolver URL and match requested synchronized weights",async()=>{
  clock=BASE;
  for(let count=0;count<=3;count++){
    const refs=LORAS.slice(0,count).map((handle,i)=>({handle,strength_model:[0,0.375,1.5][i]!,strength_clip:[0,0.375,1.5][i]!}));
    const issuer=createOwnerFluxImageAssetBindingIssuer(resolvers(),options);const set=await issuer.issue(issueInput("flux-1",undefined,refs));
    const candidate=prepareOwnerFluxImageRequest({principal:PRINCIPAL,attempt_id:PRINCIPAL.connection_id,model_id:"flux-1",parameters:parameters("flux-1",refs),asset_set:set,prompt:"bound lora"},options);
    assert.equal(candidate.parameters.workflow_type,count?"civitai":"default");assert.equal(candidate.lora_assets.length,count);
    assert.deepEqual(candidate.lora_assets.map(x=>[x.strength_model,x.strength_clip]),refs.map(x=>[x.strength_model,x.strength_clip]));
    assert.deepEqual(candidate.request.settings.civitai_loras,refs.map((x,i)=>({id:String(900+i),url:`https://civitai.com/api/download/models/${900+i}?format=SafeTensor`,strength_model:x.strength_model,strength_clip:x.strength_clip})));
    assert.equal(Object.keys(candidate).includes("request"),false);assert.equal(JSON.stringify(candidate).includes("civitai.com"),false);
    if(count>0)assert.throws(()=>prepareOwnerFluxImageRequest({principal:PRINCIPAL,attempt_id:PRINCIPAL.connection_id,model_id:"flux-1",parameters:parameters("flux-1",refs.map(x=>({...x,strength_model:0.25,strength_clip:0.25}))),asset_set:set,prompt:"mismatch"},options));
    issuer.close();
  }
});

test("verified 73 MiB LoRA remains preparable with synchronized weight while the image ceiling stays separate",async()=>{
  clock=BASE;
  const sourceBytes=73*1024*1024;
  const refs=[{handle:LORAS[0]!,strength_model:0.75,strength_clip:0.75}];
  const base=resolvers();
  const issuer=createOwnerFluxImageAssetBindingIssuer({...base,async resolveLora(c:Readonly<OwnerFluxAssetResolverContext>){
    return {...await base.resolveLora(c),size:sourceBytes};
  }},options);
  try{
    const set=await issuer.issue(issueInput("flux-1",undefined,refs));
    const candidate=prepareOwnerFluxImageRequest({principal:PRINCIPAL,attempt_id:PRINCIPAL.connection_id,model_id:"flux-1",
      parameters:parameters("flux-1",refs),asset_set:set,prompt:"verified bounded LoRA"},options);
    assert.equal(candidate.lora_assets[0]?.size,76_546_048);
    assert.deepEqual(candidate.request.settings.civitai_loras,[{id:"900",url:"https://civitai.com/api/download/models/900?format=SafeTensor",
      strength_model:0.75,strength_clip:0.75}]);
    assert.equal(candidate.dispatch_allowed,false);
    assert.equal(candidate.backend_acceptance,"UNPROVEN");
  }finally{issuer.close();}
});

test("Flux enforces exact finite LoRA and image byte boundaries and rejects invalid sizes",async()=>{
  clock=BASE;
  const refs=[{handle:LORAS[0]!,strength_model:0.5,strength_clip:0.5}];
  const exactIssuer=createOwnerFluxImageAssetBindingIssuer(resolvers({size:1_073_741_824}),options);
  try{
    const set=await exactIssuer.issue(issueInput("flux-1",undefined,refs));
    const candidate=prepareOwnerFluxImageRequest({principal:PRINCIPAL,attempt_id:PRINCIPAL.connection_id,model_id:"flux-1",
      parameters:parameters("flux-1",refs),asset_set:set,prompt:"exact local LoRA boundary"},options);
    assert.equal(candidate.lora_assets[0]?.size,1_073_741_824);
  }finally{exactIssuer.close();}

  const rejected=(error:unknown)=>typeof error==="object"&&error!==null&&"code" in error&&error.code==="ASSET_UNAVAILABLE";
  for(const size of [1_073_741_825,0,1.5,Number.NaN,Number.MAX_SAFE_INTEGER]){
    const issuer=createOwnerFluxImageAssetBindingIssuer(resolvers({size}),options);
    try{await assert.rejects(issuer.issue(issueInput("flux-1",undefined,refs)),rejected);}finally{issuer.close();}
  }
  const imageIssuer=createOwnerFluxImageAssetBindingIssuer(resolvers({size:33_554_433}),options);
  try{await assert.rejects(imageIssuer.issue(issueInput("flux-1",IMAGE)),rejected);}finally{imageIssuer.close();}
});

test("URL syntax alone, provenance mismatch, caller URL replacement, and unsafe Civitai queries never establish binding",async()=>{
  clock=BASE;
  const bad=[
    {provenance:"private_r2_owned"},
    {canonical_url:"https://civitai.com/api/download/models/900?token=never-echo"},
    {asset_id:"901"},
    {canonical_url:"https://r2.syntx.ai/private/model.safetensors"},
    {model_id:"flux-pro-1.1"}
  ];
  for(const extra of bad){const issuer=createOwnerFluxImageAssetBindingIssuer(resolvers(extra),options);await assert.rejects(issuer.issue(issueInput("flux-1",undefined,[{handle:LORAS[0]!,strength_model:0.5,strength_clip:0.5}])),(e:unknown)=>!String((e as Error).message).includes("never-echo"));issuer.close();}
  const issuer=createOwnerFluxImageAssetBindingIssuer(resolvers(),options);const lora=[{handle:LORAS[0]!,strength_model:0.5,strength_clip:0.5}];const set=await issuer.issue(issueInput("flux-1",undefined,lora));
  const injected={...parameters("flux-1",lora),civitai_loras:[{...lora[0]!,url:"https://civitai.com/api/download/models/123"}]};
  assert.throws(()=>prepareOwnerFluxImageRequest({principal:PRINCIPAL,attempt_id:PRINCIPAL.connection_id,model_id:"flux-1",parameters:injected,asset_set:set,prompt:"url injection"},options));issuer.close();

  const privateIssuer=createOwnerFluxImageAssetBindingIssuer(resolvers({provenance:"private_r2_owned",canonical_url:"https://r2.syntx.ai/private/900.safetensors"}),options);
  const privateSet=await privateIssuer.issue(issueInput("flux-1",undefined,lora));
  const privateCandidate=prepareOwnerFluxImageRequest({principal:PRINCIPAL,attempt_id:PRINCIPAL.connection_id,model_id:"flux-1",parameters:parameters("flux-1",lora),asset_set:privateSet,prompt:"owned private lora"},options);
  const privateWireLoras=privateCandidate.request.settings.civitai_loras as readonly {url:string}[];
  assert.equal(privateWireLoras[0]!.url,"https://r2.syntx.ai/private/900.safetensors");
  assert.equal(privateCandidate.lora_assets[0]!.provenance,"private_r2_owned");privateIssuer.close();
});

test("clones, wrong principal, source invalidation, and expired asset sets fail closed",async()=>{
  clock=BASE;const issuer=createOwnerFluxImageAssetBindingIssuer(resolvers(),options);const set=await issuer.issue(issueInput("flux-1",IMAGE));
  const input={principal:PRINCIPAL,attempt_id:PRINCIPAL.connection_id,model_id:"flux-1" as const,parameters:parameters("flux-1"),asset_set:set,prompt:"owned"};
  assert.throws(()=>prepareOwnerFluxImageRequest({...input,asset_set:Object.freeze({...set})},options));
  assert.throws(()=>prepareOwnerFluxImageRequest({...input,principal:{...PRINCIPAL,subject_id:"other"}},options));
  issuer.invalidateAttempt(PRINCIPAL.connection_id);assert.throws(()=>prepareOwnerFluxImageRequest(input,options));issuer.close();
  const expiring=createOwnerFluxImageAssetBindingIssuer({...resolvers(),async resolveImage(c:Readonly<OwnerFluxAssetResolverContext>){return {...await resolvers().resolveImage(c),expires_at:BASE+100};}},options);
  const short=await expiring.issue(issueInput("flux-1",IMAGE));clock=BASE+100;assert.throws(()=>prepareOwnerFluxImageRequest({...input,asset_set:short},options));expiring.close();
});
