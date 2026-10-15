import { types } from "node:util";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";

const MODELS = ["wan_26_r2v", "wan_26_r2v_flash"] as const;
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
type Model = typeof MODELS[number];
export interface OwnerWan26R2vVideoResultContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly string[];
  readonly model_id: Model;
}
export type OwnerWan26R2vVideoResultGap =
  | "ENVELOPE_SHAPE_INVALID" | "OUTER_MESSAGE_ID_MISMATCH" | "NOT_BOT_MESSAGE" | "PROVIDER_CHAT_ID_MISMATCH"
  | "UNRECOGNIZED_MESSAGE_FIELDS" | "MESSAGE_OBJECT_ARRAY_INVALID" | "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT"
  | "OBJECT_ENTRY_INVALID" | "UNRECOGNIZED_OBJECT_FIELDS" | "OBJECT_ID_UNAVAILABLE" | "OBJECT_ID_DUPLICATE"
  | "OBJECT_ID_UNEXPECTED" | "OBJECT_MESSAGE_ID_MISMATCH" | "OBJECT_TYPE_UNSUPPORTED" | "OBJECT_ORDER_MISMATCH"
  | "MODEL_ECHO_MISMATCH" | "MODEL_ECHO_UNAVAILABLE" | "OBJECT_NOT_COMPLETED" | "RESULT_COMPLETION_FLAG_INVALID"
  | "RESULT_URL_PENDING" | "RESULT_URL_UNSAFE" | "EXPECTED_OBJECT_ID_MISSING";
export interface OwnerWan26R2vReadyVideo {
  readonly object_index: number;
  readonly message_object_id: string;
  readonly object_type: "video";
  readonly object_url: string;
  readonly mime_type: "video/mp4" | "video/webm" | null;
  readonly mime_source: "URL_EXTENSION_LOCAL_POLICY" | "UNKNOWN";
  readonly model_echo: "MATCHED" | "UNKNOWN";
}
export interface OwnerWan26R2vVideoResult {
  readonly message_binding: "BOUND" | "UNVERIFIED";
  readonly model_echo: "MATCHED" | "UNKNOWN" | "MISMATCH";
  readonly result_status: "OBSERVED" | "PENDING" | "UNVERIFIED";
  readonly ready_videos: readonly OwnerWan26R2vReadyVideo[];
  readonly pending_object_indices: readonly number[];
  readonly gaps: readonly Readonly<{ object_index: number | null; code: OwnerWan26R2vVideoResultGap }>[];
  readonly provider_terminal_status: "UNPROVEN";
  readonly backend_acceptance: "UNPROVEN";
  readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
}
/** Decodes an already-observed generic message envelope; context is correlation data, not transport authority. */
export function decodeOwnerWan26R2vVideoResult(raw: unknown, expectedInput: unknown): OwnerWan26R2vVideoResult {
  const expected = context(expectedInput);
  const gaps: { object_index: number | null; code: OwnerWan26R2vVideoResultGap }[] = [];
  const invalid = (code: OwnerWan26R2vVideoResultGap): OwnerWan26R2vVideoResult =>
    make("UNVERIFIED", "UNKNOWN", "UNVERIFIED", [], [], [{ object_index: null, code }]);
  if (!graph(raw)) return invalid("ENVELOPE_SHAPE_INVALID");
  const message = rec(raw, ["id", "chat_id", "author_id", "message_object"], [], ["created_at", "updated_at", "is_favorite"]);
  if (!message) return invalid("ENVELOPE_SHAPE_INVALID");
  if (id(message.v.id) !== expected.message_id) return invalid("OUTER_MESSAGE_ID_MISMATCH");
  if (message.v.author_id !== -1) return invalid("NOT_BOT_MESSAGE");
  if (chatId(message.v.chat_id) !== expected.provider_chat_id) return invalid("PROVIDER_CHAT_ID_MISMATCH");
  if (message.unknown) gaps.push({ object_index: null, code: "UNRECOGNIZED_MESSAGE_FIELDS" });

  const items = arr(message.v.message_object, 64);
  if (!items) return invalid("MESSAGE_OBJECT_ARRAY_INVALID");
  if (items.length > 64) return invalid("MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT");
  const expectedSet = new Set(expected.message_object_ids);
  const seen = new Set<string>();
  const observed = new Set<string>();
  const ready: OwnerWan26R2vReadyVideo[] = [];
  const pending: number[] = [];
  let mismatch = false;
  let unknown = false;
  let targetEcho = false;
  let orderMismatch = false;
  let nextExpectedIndex = 0;

  for (let index = 0; index < items.length; index += 1) {
    const object = rec(items[index], ["id", "message_id", "object_type"],
      ["model_type", "object_text", "completed", "object_url"], ["created_at", "updated_at", "task_id", "metadata"]);
    if (!object) { gaps.push({ object_index: index, code: "OBJECT_ENTRY_INVALID" }); continue; }
    if (object.unknown) gaps.push({ object_index: index, code: "UNRECOGNIZED_OBJECT_FIELDS" });
    const objectId = id(object.v.id);
    if (!objectId) { gaps.push({ object_index: index, code: "OBJECT_ID_UNAVAILABLE" }); continue; }
    if (seen.has(objectId)) { gaps.push({ object_index: index, code: "OBJECT_ID_DUPLICATE" }); continue; }
    seen.add(objectId);
    if (!expectedSet.has(objectId)) { gaps.push({ object_index: index, code: "OBJECT_ID_UNEXPECTED" }); continue; }
    if (id(object.v.message_id) !== expected.message_id) { gaps.push({ object_index: index, code: "OBJECT_MESSAGE_ID_MISMATCH" }); continue; }
    observed.add(objectId);
    const expectedIndex = expected.message_object_ids.indexOf(objectId);
    const inOrder = !orderMismatch && expectedIndex === nextExpectedIndex;
    if (!inOrder) { orderMismatch = true; gaps.push({ object_index: index, code: "OBJECT_ORDER_MISMATCH" }); }
    else nextExpectedIndex += 1;
    if (object.v.object_type !== "video") { gaps.push({ object_index: index, code: "OBJECT_TYPE_UNSUPPORTED" }); continue; }
    const modelEcho = object.v.model_type;
    if (modelEcho === undefined || modelEcho === null || modelEcho === "") {
      unknown = true; gaps.push({ object_index: index, code: "MODEL_ECHO_UNAVAILABLE" });
    } else if (modelEcho !== expected.model_id) {
      mismatch = true; gaps.push({ object_index: index, code: "MODEL_ECHO_MISMATCH" }); continue;
    } else targetEcho = true;
    if (!inOrder || modelEcho !== expected.model_id) continue;
    if (object.v.completed === false) { pending.push(index); gaps.push({ object_index: index, code: "OBJECT_NOT_COMPLETED" }); continue; }
    if (object.v.completed !== true) { gaps.push({ object_index: index, code: "RESULT_COMPLETION_FLAG_INVALID" }); continue; }
    const url = object.v.object_url;
    if (url === null || url === undefined || url === "") { pending.push(index); gaps.push({ object_index: index, code: "RESULT_URL_PENDING" }); continue; }
    if (typeof url !== "string" || url.length > 4096 || !isSafeUploadReferenceUrl(url)) {
      gaps.push({ object_index: index, code: "RESULT_URL_UNSAFE" }); continue;
    }
    const mime = /\.mp4(?:$|[?#])/iu.test(url) ? "video/mp4" : /\.webm(?:$|[?#])/iu.test(url) ? "video/webm" : null;
    ready.push(Object.freeze({ object_index: index, message_object_id: objectId, object_type: "video", object_url: url,
      mime_type: mime, mime_source: mime ? "URL_EXTENSION_LOCAL_POLICY" : "UNKNOWN", model_echo: "MATCHED" }));
  }
  for (const objectId of expected.message_object_ids) {
    if (!observed.has(objectId)) gaps.push({ object_index: null, code: "EXPECTED_OBJECT_ID_MISSING" });
  }
  const output = orderMismatch ? [] : expected.message_object_ids.flatMap(objectId => ready.filter(video => video.message_object_id === objectId));
  const echo = mismatch ? "MISMATCH" : unknown || !targetEcho ? "UNKNOWN" : "MATCHED";
  const status = pending.length > 0 ? "PENDING" : output.length > 0 ? "OBSERVED" : "UNVERIFIED";
  return make("BOUND", echo, status, output, pending, gaps);
}
function context(x:unknown):OwnerWan26R2vVideoResultContext {if(!graph(x))throw new TypeError("INVALID_OWNER_WAN26_R2V_VIDEO_RESULT_CONTEXT");const r=rec(x,["chat_uuid","message_id","provider_chat_id","message_object_ids","model_id"]);const ids=r&&arr(r.v.message_object_ids,64);if(!r||r.unknown||!safe(r.v.chat_uuid)||!safe(r.v.message_id)||typeof r.v.provider_chat_id!=="string"||!/^\d{1,16}$/u.test(r.v.provider_chat_id)||!ids||ids.length===0||ids.some(v=>!safe(v))||new Set(ids).size!==ids.length||!MODELS.includes(r.v.model_id as Model))throw new TypeError("INVALID_OWNER_WAN26_R2V_VIDEO_RESULT_CONTEXT");return Object.freeze({chat_uuid:r.v.chat_uuid,message_id:r.v.message_id,provider_chat_id:r.v.provider_chat_id,message_object_ids:Object.freeze(ids as string[]),model_id:r.v.model_id as Model});}
function make(binding:OwnerWan26R2vVideoResult["message_binding"],echo:OwnerWan26R2vVideoResult["model_echo"],status:OwnerWan26R2vVideoResult["result_status"],videos:readonly OwnerWan26R2vReadyVideo[],pending:readonly number[],gaps:readonly {object_index:number|null;code:OwnerWan26R2vVideoResultGap}[]):OwnerWan26R2vVideoResult{return Object.freeze({message_binding:binding,model_echo:echo,result_status:status,ready_videos:Object.freeze([...videos]),pending_object_indices:Object.freeze([...pending]),gaps:Object.freeze(gaps.map(x=>Object.freeze({...x}))),provider_terminal_status:"UNPROVEN",backend_acceptance:"UNPROVEN",status_semantics:"LOCAL_OBSERVED_AVAILABILITY_ONLY"});}
function rec(x:unknown,req:string[],optional:string[]=[],inert:string[]=[]):{v:Record<string,unknown>;unknown:boolean}|null{try{if(!x||typeof x!=="object"||types.isProxy(x)||Array.isArray(x))return null;const p=Object.getPrototypeOf(x);if(p!==Object.prototype&&p!==null)return null;const ds=Object.getOwnPropertyDescriptors(x),v=Object.create(null) as Record<string,unknown>;let unknown=false;for(const k of Reflect.ownKeys(ds)){if(typeof k!=="string"){unknown=true;continue;}const d=ds[k]!;if(!("value"in d)||!d.enumerable)return null;if(req.includes(k)||optional.includes(k))v[k]=d.value;else if(!inert.includes(k))unknown=true;}if(req.some(k=>!Object.hasOwn(v,k)))return null;return{v,unknown};}catch{return null;}}
function arr(x:unknown,max:number):unknown[]|null{try{if(!Array.isArray(x)||types.isProxy(x)||Object.getPrototypeOf(x)!==Array.prototype)return null;const ds=Object.getOwnPropertyDescriptors(x),n=Object.getOwnPropertyDescriptor(x,"length")?.value;if(!Number.isSafeInteger(n))return null;if(n>max)return new Array(max+1);const keys=Reflect.ownKeys(ds);if(keys.length!==n+1||keys.some(k=>k!=="length"&&(typeof k!=="string"||! /^(?:0|[1-9]\d*)$/u.test(k)||Number(k)>=n)))return null;const a=[];for(let i=0;i<n;i++){const d=ds[String(i)];if(!d||!("value"in d)||!d.enumerable)return null;a.push(d.value);}return a;}catch{return null;}}
function graph(root:unknown):boolean{
  const active=new WeakSet<object>(),seen=new WeakSet<object>();let nodes=0;
  const visit=(value:unknown,depth:number):boolean=>{
    if(++nodes>512||depth>8||typeof value==="function"||typeof value==="symbol"||typeof value==="bigint")return false;
    if(typeof value==="number"&&!Number.isFinite(value))return false;
    if(value===null||typeof value!=="object")return true;
    if(types.isProxy(value)||active.has(value))return false;if(seen.has(value))return true;
    const isArray=Array.isArray(value),prototype=Object.getPrototypeOf(value);
    if(isArray?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)return false;
    active.add(value);const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
    if(keys.some(key=>typeof key!=="string"))return false;
    if(isArray){const length=Object.getOwnPropertyDescriptor(value,"length")?.value;if(!Number.isSafeInteger(length)||keys.length!==(length as number)+1||keys.some(key=>key!=="length"&&(typeof key!=="string"||! /^(?:0|[1-9]\d*)$/u.test(key)||Number(key)>=(length as number))))return false;}
    for(const key of keys){if(isArray&&key==="length")continue;const descriptor=descriptors[key as keyof typeof descriptors];if(!descriptor||!("value"in descriptor)||descriptor.enumerable!==true||!visit(descriptor.value,depth+1))return false;}
    active.delete(value);seen.add(value);return true;
  };
  try{return visit(root,0);}catch{return false;}
}
function id(x:unknown):string|null{return typeof x==="string"&&ID.test(x)?x:typeof x==="number"&&Number.isSafeInteger(x)&&x>0?String(x):null;}function safe(x:unknown):x is string{return typeof x==="string"&&ID.test(x);}function chatId(x:unknown):string|null{return typeof x==="number"&&Number.isSafeInteger(x)&&x>0?String(x):null;}
