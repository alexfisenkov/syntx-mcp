import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import type { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import type { OwnerWan27I2vUploadDestination } from "../application/owner-wan27-i2v-reference-service.js";
import { OwnerWan27I2vReferenceService } from "../application/owner-wan27-i2v-reference-service.js";
import { OwnerWan27I2vGenerationService, loadOwnerWan27I2vRuntimeCatalog } from "../application/owner-wan27-i2v-generation-service.js";

const STARTUP_CLEANUPS=new WeakMap<object,Promise<void>>(),MAX_CLIENTS=128;
export interface OwnerWan27I2vRuntimeOptions{
  readonly binding:AuthBinding;readonly linkService:PerUserLinkService;readonly catalogDirectory?:string;
  readonly createReadClient:(attemptId:string)=>SyntxHttpClient;readonly createChatClient:(attemptId:string)=>SyntxChatHttpClient;
  readonly uploadDestination:OwnerWan27I2vUploadDestination;readonly now:()=>number;
}
export function createOwnerWan27I2vRuntime(options:OwnerWan27I2vRuntimeOptions){
  if(!options||typeof options.createReadClient!=="function"||typeof options.createChatClient!=="function"||
    typeof options.now!=="function"||(options.uploadDestination!=="uploaded"&&options.uploadDestination!=="hidden"))
    throw new Error("OWNER_WAN27_I2V_RUNTIME_CONFIGURATION_INVALID");
  const runtimeCatalog=loadOwnerWan27I2vRuntimeCatalog(options.catalogDirectory),clients=new Map<string,SyntxChatHttpClient>();
  const resolve=(attempt:string):SyntxChatHttpClient=>{
    const old=clients.get(attempt);if(old)return old;
    if(clients.size>=MAX_CLIENTS)throw new Error("OWNER_WAN27_I2V_CLIENT_CAPACITY_EXCEEDED");
    const client=options.createChatClient(attempt);clients.set(attempt,client);return client;
  };
  let references:OwnerWan27I2vReferenceService|undefined,generation:OwnerWan27I2vGenerationService|undefined;
  try{
    references=new OwnerWan27I2vReferenceService({binding:options.binding,linkService:options.linkService,
      resolveChatClient:resolve,uploadDestination:options.uploadDestination,now:options.now});
    generation=new OwnerWan27I2vGenerationService({binding:options.binding,linkService:options.linkService,
      referenceService:references,catalog:runtimeCatalog.catalog,...(options.catalogDirectory?{catalogDirectory:options.catalogDirectory}:{}),
      resolveChatClient:resolve,createReadClient:options.createReadClient,now:options.now});
  }catch(error){
    const cleanup=settleClosures([()=>generation?.close(),()=>references?.close()]).finally(()=>clients.clear());
    if(error&&typeof error==="object")STARTUP_CLEANUPS.set(error,cleanup);throw error;
  }
  const imageVault=references,generationService=generation,invalidations=new Map<string,Promise<void>>();
  let closing:Promise<void>|undefined;
  const lifecycle=Object.freeze({
    invalidateAttempt(attempt:string):Promise<void>{
      const prior=invalidations.get(attempt);if(prior)return prior;
      const pending=settleClosures([()=>generationService.invalidateAttempt(attempt),()=>imageVault.invalidateAttempt(attempt)])
        .finally(()=>{clients.delete(attempt);invalidations.delete(attempt);});
      invalidations.set(attempt,pending);return pending;
    },
    close():Promise<void>{
      closing??=settleClosures([()=>generationService.close(),()=>imageVault.close()]).finally(()=>{clients.clear();invalidations.clear();});
      return closing;
    }
  });
  return Object.freeze({runtimeCatalog,imageVault,generationService,lifecycle});
}
export function getOwnerWan27I2vRuntimeStartupCleanup(error:unknown):Promise<void>|undefined{
  return error&&typeof error==="object"?STARTUP_CLEANUPS.get(error):undefined;
}
async function settleClosures(closures:readonly (()=>Promise<void>|undefined)[]):Promise<void>{
  const results=await Promise.allSettled(closures.map(async close=>{await close();}));
  const failures=results.flatMap(result=>result.status==="rejected"?[result.reason]:[]);
  if(failures.length===1)throw failures[0];
  if(failures.length>1)throw new AggregateError(failures,"WAN 2.7 I2V cleanup was not confirmed.");
}
