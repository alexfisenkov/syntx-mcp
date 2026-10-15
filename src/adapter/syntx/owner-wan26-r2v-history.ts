import { types } from "node:util";

const MODELS = ["wan_26_r2v", "wan_26_r2v_flash"] as const;
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
export type OwnerWan26R2vModelId = typeof MODELS[number];
export type OwnerWan26R2vHistoryGap = "HISTORY_INPUT_INVALID" | "HISTORY_PAGE_INVALID" | "HISTORY_INCOMPLETE" |
  "HISTORY_UNKNOWN_FIELDS" | "OWNER_ACK_MISSING" | "OWNER_ACK_MISMATCH" | "OWNER_ACK_AMBIGUOUS" |
  "BOT_RESULT_NOT_OBSERVED" | "BOT_ERROR_OBSERVED" | "BOT_VIDEO_INCOMPLETE" | "BOT_VIDEO_MODEL_MISMATCH";
export interface OwnerWan26R2vHistoryWitness {
  readonly status: "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly history_binding_status: "BOUND" | "PARTIAL" | "UNVERIFIED";
  readonly provider_chat_id: string | null;
  readonly owner_echo_message_id: string | null;
  readonly candidate_messages: readonly Readonly<{ message_id: string; message_object_ids: readonly string[] }>[];
  readonly bot_error_observed: boolean;
  readonly gaps: readonly OwnerWan26R2vHistoryGap[];
  readonly backend_acceptance: "UNPROVEN";
}

type Rec = { values: Record<string, unknown>; unknown: boolean };
/** Reads bounded generic history envelopes. This is correlation evidence, never GET or dispatch authority. */
export function bindOwnerWan26R2vHistory(input: unknown): OwnerWan26R2vHistoryWitness {
  if (!safeGraph(input)) return empty("UNVERIFIED", "HISTORY_INPUT_INVALID");
  const root = record(input, ["pages", "expected"]);
  const expected = root && record(root.values.expected, ["chat_uuid", "owner_echo_message_id", "prompt", "model_id"]);
  if (!root || root.unknown || !expected || expected.unknown || !safeId(expected.values.chat_uuid) ||
      !(expected.values.owner_echo_message_id === null || safeId(expected.values.owner_echo_message_id)) ||
      typeof expected.values.prompt !== "string" || !isModel(expected.values.model_id)) return empty("UNVERIFIED", "HISTORY_INPUT_INVALID");
  const pages = array(root.values.pages, 7);
  if (!pages) return empty("UNVERIFIED", "HISTORY_PAGE_INVALID");
  if (pages.length === 0 || pages.length > 7) return empty("INCOMPLETE", "HISTORY_INCOMPLETE");
  const rows: { id: string; chat: string; author: number; objects: { id: string; type: string; model: unknown; text: unknown; completed: unknown }[] }[] = [];
  let chat: string | undefined, unknown = false, total: number | undefined, objectCount = 0;
  const messageIds = new Set<string>();
  const objectIds = new Set<string>();
  for (let i = 0; i < pages.length; i++) {
    const page = record(pages[i], ["messages", "pagination"], ["created_at", "updated_at"]);
    const pagination = page && record(page.values.pagination, ["page", "page_size", "total_count", "total_pages", "has_next", "has_previous"], ["next", "previous"]);
    const messages = page && array(page.values.messages, 64);
    if (!page || !pagination || !messages) return empty("UNVERIFIED", "HISTORY_PAGE_INVALID");
    unknown ||= page.unknown || pagination.unknown;
    const p = pagination.values, count = p.total_count, tp = p.total_pages;
    const expectedPages = typeof count === "number" && count === 0 ? 0 : typeof count === "number" ? Math.ceil(count / 10) : -1;
    if (![p.page,p.page_size,count,tp].every(Number.isSafeInteger) || typeof p.has_next !== "boolean" || typeof p.has_previous !== "boolean" || p.page !== i+1 || p.page_size !== 10 || (count as number) < 0 || (count as number) > 64 || (tp as number) < 0 || tp !== expectedPages || p.has_next !== (i+1 < (tp as number)) || p.has_previous !== (i > 0) || messages.length !== Math.min(10, Math.max(0,(count as number)-i*10)) || (total !== undefined && total !== count)) return empty("INCOMPLETE", "HISTORY_INCOMPLETE");
    total = count as number;
    for (const raw of messages) {
      const row = record(raw, ["id","chat_id","author_id","message_object"], ["created_at","updated_at","is_favorite"]);
      const rowId = row && providerId(row.values.id), rowChat = row && providerChat(row.values.chat_id);
      const objects = row && array(row.values.message_object, 64);
      if (!row || !rowId || !rowChat || !Number.isSafeInteger(row.values.author_id) || !objects || messageIds.has(rowId) || (chat !== undefined && chat !== rowChat)) return empty("UNVERIFIED", "HISTORY_PAGE_INVALID");
      messageIds.add(rowId); chat ??= rowChat; unknown ||= row.unknown; objectCount += objects.length;
      if (objectCount > 64) return empty("INCOMPLETE", "HISTORY_INCOMPLETE");
      const normalized = [];
      for (const item of objects) {
        const o = record(item,["id","message_id","object_type"],["object_url","created_at","updated_at","task_id","metadata"],["model_type","object_text","completed"]);
        const oid = o && providerId(o.values.id);
        if (!o || !oid || objectIds.has(oid) || providerId(o.values.message_id) !== rowId || typeof o.values.object_type !== "string") return empty("UNVERIFIED", "HISTORY_PAGE_INVALID");
        objectIds.add(oid); unknown ||= o.unknown;
        normalized.push({id:oid,type:o.values.object_type,model:o.values.model_type,text:o.values.object_text,completed:o.values.completed});
      }
      rows.push({id:rowId,chat:rowChat,author:row.values.author_id as number,objects:normalized});
    }
  }
  if (rows.length !== total) return empty("INCOMPLETE", "HISTORY_INCOMPLETE");
  const requiredPageCount = Math.max(1, Math.ceil((total ?? 0) / 10));
  if (pages.length !== requiredPageCount) return empty("INCOMPLETE", "HISTORY_INCOMPLETE");
  const gaps = new Set<OwnerWan26R2vHistoryGap>();
  if (unknown) gaps.add("HISTORY_UNKNOWN_FIELDS");
  const model = expected.values.model_id;
  const ack = (row: typeof rows[number]) => { const texts = row.objects.filter(o => o.type === "text"); return texts.length === 1 && texts[0]!.model === model && texts[0]!.text === expected.values.prompt; };
  const ackId = expected.values.owner_echo_message_id;
  const matches = typeof ackId === "string" ? rows.filter(r => r.id === ackId && r.author > 0 && ack(r)) : rows.filter(r => r.author > 0 && ack(r));
  const ackStatus = matches.length > 1 ? "AMBIGUOUS" : matches.length === 1 ? "MATCHED" : typeof ackId === "string" && rows.some(r=>r.id===ackId) ? "MISMATCH" : "MISSING";
  if (ackStatus !== "MATCHED") gaps.add(ackStatus === "AMBIGUOUS" ? "OWNER_ACK_AMBIGUOUS" : ackStatus === "MISMATCH" ? "OWNER_ACK_MISMATCH" : "OWNER_ACK_MISSING");
  const candidates: {message_id:string;message_object_ids:readonly string[]}[] = [];
  let error = false, unresolved = false;
  for (const row of rows) if (row.author === -1) {
    const out: string[] = [];
    for (const o of row.objects) {
      if (o.model !== model) { if (o.type === "video") { unresolved = true; gaps.add("BOT_VIDEO_MODEL_MISMATCH"); } continue; }
      if (o.type === "error") { error = true; gaps.add("BOT_ERROR_OBSERVED"); }
      else if (o.type === "video") { if (o.completed === true) out.push(o.id); else { unresolved = true; gaps.add("BOT_VIDEO_INCOMPLETE"); } }
    }
    if (out.length) candidates.push(Object.freeze({message_id:row.id,message_object_ids:Object.freeze(out)}));
  }
  if (!candidates.length && !error && !unresolved) gaps.add("BOT_RESULT_NOT_OBSERVED");
  const good = ackStatus === "MATCHED" && candidates.length > 0 && !error && !unresolved;
  return Object.freeze({status:good?"COMPLETE":"PENDING",owner_ack_status:ackStatus,history_binding_status:ackStatus === "MATCHED" && !unknown && !error && !unresolved ? "BOUND":"PARTIAL",provider_chat_id:chat ?? null,owner_echo_message_id:matches[0]?.id ?? null,candidate_messages:Object.freeze(candidates),bot_error_observed:error,gaps:Object.freeze([...gaps]),backend_acceptance:"UNPROVEN"});
}

function record(value: unknown, required: string[], inert: string[] = [], optional: string[] = []): Rec | null {
  try { if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) return null; const proto=Object.getPrototypeOf(value); if(proto!==Object.prototype&&proto!==null)return null; const ds=Object.getOwnPropertyDescriptors(value), values=Object.create(null) as Record<string,unknown>; let unknown=false; for(const key of Reflect.ownKeys(ds)){if(typeof key!=="string"){unknown=true;continue;}const d=ds[key]!;if(!("value" in d)||!d.enumerable)return null;if(required.includes(key)||optional.includes(key))values[key]=d.value;else if(!inert.includes(key))unknown=true;}if(required.some(k=>!Object.hasOwn(values,k)))return null;return {values,unknown};}catch{return null;}
}
function array(value: unknown, max: number): unknown[] | null { try { if(!Array.isArray(value)||types.isProxy(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>max)return null;const ds=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(ds);if(keys.length!==value.length+1||keys.some(k=>k!=="length"&&(typeof k!=="string"||! /^(?:0|[1-9]\d*)$/u.test(k)||Number(k)>=value.length)))return null;const out=[];for(let i=0;i<value.length;i++){const d=ds[String(i)];if(!d||!("value"in d)||!d.enumerable)return null;out.push(d.value);}return out;}catch{return null;} }
function safeGraph(root: unknown): boolean {
  const active = new WeakSet<object>();
  const seen = new WeakSet<object>();
  let nodes = 0;
  const visit = (value: unknown, depth: number): boolean => {
    if (++nodes > 512 || depth > 8 || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") return false;
    if (typeof value === "number" && !Number.isFinite(value)) return false;
    if (value === null || typeof value !== "object") return true;
    if (types.isProxy(value) || active.has(value)) return false;
    if (seen.has(value)) return true;
    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false;
    active.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== "string")) return false;
    if (isArray) {
      const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
      if (!Number.isSafeInteger(length) || (length as number) > 512 || keys.length !== (length as number) + 1) return false;
      if (keys.some(key => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= (length as number)))) return false;
    }
    for (const key of keys) {
      if (isArray && key === "length") continue;
      const descriptor = descriptors[key as keyof typeof descriptors];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true || !visit(descriptor.value, depth + 1)) return false;
    }
    active.delete(value);
    seen.add(value);
    return true;
  };
  try { return visit(root, 0); } catch { return false; }
}
function providerId(v:unknown):string|null{return typeof v==="string"&&ID.test(v)?v:typeof v==="number"&&Number.isSafeInteger(v)&&v>0?String(v):null;}
function providerChat(v:unknown):string|null{return typeof v==="number"&&Number.isSafeInteger(v)&&v>0?String(v):null;}
function safeId(v:unknown):v is string{return typeof v==="string"&&ID.test(v);}
function isModel(v:unknown):v is OwnerWan26R2vModelId{return typeof v==="string"&&MODELS.includes(v as OwnerWan26R2vModelId);}
function empty(status:OwnerWan26R2vHistoryWitness["status"],gap:OwnerWan26R2vHistoryGap):OwnerWan26R2vHistoryWitness{return Object.freeze({status,owner_ack_status:"MISSING",history_binding_status:"UNVERIFIED",provider_chat_id:null,owner_echo_message_id:null,candidate_messages:Object.freeze([]),bot_error_observed:false,gaps:Object.freeze([gap]),backend_acceptance:"UNPROVEN"});}
