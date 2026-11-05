import { normalizeOwnerKlingI2vParameters } from "../src/application/owner-kling-i2v-parameters.js";
import { normalizeOwnerKlingKeyframesParameters } from "../src/application/owner-kling-keyframes-parameters.js";
import { normalizeOwnerKling4Parameters, getOwnerKling4EffectiveProfileHash, getOwnerKling4SourceProfile } from "../src/application/owner-kling4-parameters.js";
import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { createOwnerKlingT2vCurrentProfile, createOwnerKlingO1T2vCurrentProfile, getOwnerKlingT2vCurrentControls, KLING_T2V_CURRENT_VARIANT,
  KLING_O1_T2V_CURRENT_VARIANT } from "../src/application/owner-kling-t2v-current-profile.js";
import { createOwnerKlingT2vProfile, OWNER_KLING_T2V_CONTRACT_REGISTRY_VERSION } from "../src/application/owner-kling-t2v-profile.js";
import { GenerationContractExecutorV2 } from "../src/adapter/syntx/generation-contract-executor-v2.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { OwnerKlingT2vGenerationService } from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import { registerSyntxOwnerKlingT2vTools, SYNTX_OWNER_GENERATE_KLING_T2V_TOOL_NAME,
  SYNTX_OWNER_GET_KLING_T2V_SOURCE_TOOL_NAME } from "../src/mcp/owner-kling-t2v-tools.js";
import type { ModelAccessResult } from "../src/application/model-access.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";

const ATTEMPT = "link_current_kling_t2v_0123456789abcdef";
const base = { attemptId: ATTEMPT, prompt: "A current source-control test scene", version: "3.0", mode: "4K",
  aspect_ratio: "16:9", video_duration: 5, native_audio: false, multi_shots: true } as const;
const directory = resolve(process.cwd(), "catalog");

test("current Kling controls have independent form-source lineage and preserve immutable legacy registry", () => {
  const legacy = createOwnerKlingT2vProfile("kling_text2video", directory), current = createOwnerKlingT2vCurrentProfile(directory);
  assert.equal(legacy.registryVersion, OWNER_KLING_T2V_CONTRACT_REGISTRY_VERSION);
  assert.notEqual(current.registryVersion, legacy.registryVersion);
  assert.equal(current.variantId, KLING_T2V_CURRENT_VARIANT);
  assert.equal(current.source.status, "FORM_SOURCE_REVIEWED");
  assert.equal(current.source.provider_acceptance, "UNPROVEN");
  assert.equal(current.catalog.source_hashes.models, "sha256:11f085ad9b0dd97435d6ebece623fa85bce2870e714e876e6fbb041c562fb438");
  assert.deepEqual(current.costParameterFields, ["version", "mode", "video_duration", "native_audio"]);
  assert.equal(current.registry.contracts[0]?.provenance.references.some(r => r.kind === "frontend_static" && r.sha256 === current.source.form_sha256), true);
  const { multi_shots: _omitted, ...legacyTuple } = { ...base, mode: "hd" };
  assert.equal(legacy.normalizeGenerationInput(legacyTuple).parameters.mode, "hd");
  assert.throws(() => legacy.normalizeGenerationInput(base));
});

test("current Kling explicit version/control combinations materialize source-correct native settings without aliases or defaults", () => {
  const profile = createOwnerKlingT2vCurrentProfile(directory), executor = new GenerationContractExecutorV2(profile.registry, profile.catalog);
  const prepare = (input: unknown) => {
    const normalized = profile.normalizeGenerationInput(input);
    const prepared = executor.prepare({ model_id: profile.modelId, operation_id: profile.operationId,
      catalog_version: profile.registry.catalog_version, variant_id: profile.variantId, parameters: normalized.parameters });
    return { normalized, prepared };
  };
  for (const mode of ["standart", "hd", "4K"]) for (const video_duration of [3, 15]) for (const multi_shots of [false, true]) {
    const { prepared } = prepare({ ...base, mode, video_duration, multi_shots });
    assert.equal(prepared.settings.mode, mode); assert.equal(prepared.settings.video_duration, video_duration);
    assert.equal(prepared.settings.multi_shots, multi_shots); assert.equal(Object.hasOwn(prepared.settings, "temperature"), false);
    assert.deepEqual(prepared.settings.file_urls, []); assert.equal(prepared.settings.model_type, "kling_text2video");
  }
  for (const version of getOwnerKlingT2vCurrentControls().temperature.versions) for (const temperature of [0, 0.375, 1]) {
    const { multi_shots: _omitted, ...withoutShot } = base;
    const { prepared } = prepare({ ...withoutShot, version, mode: "hd", temperature });
    assert.equal(prepared.settings.version, version); assert.equal(prepared.settings.temperature, temperature); assert.equal(Object.hasOwn(prepared.settings, "multi_shots"), false);
  }
});

test("current Kling rejects inactive controls, unsupported 4K versions, camera movement, invalid ranges and implicit current state", () => {
  const profile = createOwnerKlingT2vCurrentProfile(directory);
  const { multi_shots: _omitted, ...withoutShot } = base;
  for (const bad of [withoutShot, { ...base, temperature: 0.5 }, { ...base, version: "3.0-turbo" },
    { ...base, version: "2.6" }, { ...base, video_duration: 2 }, { ...base, video_duration: 16 },
    { ...base, video_duration: 3.5 }, { ...base, camera_movement: {} }, { ...base, model_id: "kling_o1_text2video" },
    { ...withoutShot, version: "1.6", mode: "hd", temperature: -0.1 },
    { ...withoutShot, version: "1.6", mode: "hd", temperature: 1.1 },
    { ...withoutShot, version: "1.6", mode: "hd", temperature: NaN },
    { ...withoutShot, version: "2.1-master", mode: "standart", temperature: 0.5 },
    { ...withoutShot, version: "1.6", mode: "hd", native_audio: true, temperature: 0.5 }]) assert.throws(() => profile.normalizeGenerationInput(bad));
  assert.throws(() => profile.normalizeGenerationInput(new Proxy(base, {})));
  let invoked = 0; const accessor = { ...base };
  Object.defineProperty(accessor, "prompt", { enumerable: true, get() { invoked++; return base.prompt; } });
  assert.throws(() => profile.normalizeGenerationInput(accessor)); assert.equal(invoked, 0);
});

async function fixture(options: { pending?: boolean; deny?: boolean; stale?: boolean; o1?: boolean } = {}) {
  let now = Date.parse("2026-11-06T00:00:00.000Z"), ready = !options.pending, dispatched = false;
  const binding = { tenant_id: "kling-current-controls", subject: "synthetic-owner" };
  const links = new PerUserLinkService({ authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "kling-current", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-kling-current" }); return { state: "LINKED" }; }
  }, new InMemoryAuthLinkStore(() => now), { now: () => now, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(binding); await links.issueHandoff(binding, ATTEMPT); await links.checkAttempt(binding, ATTEMPT);
  const modelId = options.o1 ? "kling_o1_text2video" : "kling_text2video";
  const profile = createOwnerKlingT2vProfile(modelId, directory), current = options.o1 ? createOwnerKlingO1T2vCurrentProfile(directory) : createOwnerKlingT2vCurrentProfile(directory);
  const requests: Array<{ path: string; method: string; body: unknown }> = [], costs: Array<Readonly<Record<string, unknown>>> = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input)), method = init.method ?? "GET";
    assert.equal(url.origin, "https://api.syntx.ai");
    const body = typeof init.body === "string" ? JSON.parse(init.body) as unknown : null;
    requests.push({ path: url.pathname, method, body });
    if (url.pathname === "/api/v1/chats" && method === "POST") return Response.json({ uuid: "kling-current-chat" });
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      assert.equal(url.searchParams.get("ai_name"), "kling"); dispatched = true; return Response.json({ id: "current-echo" });
    }
    const owner = { id: "current-echo", chat_id: 751, author_id: 42, message_object: [] };
    const bot = { id: "current-bot", chat_id: 751, author_id: -1, message_object: [{ id: "current-video", message_id: "current-bot",
      object_type: "video", model_type: modelId, completed: true, object_url: "https://r2.syntx.ai/kling-current/result.mp4" }] };
    if (url.pathname.endsWith("/inprogress")) return Response.json(ready && dispatched ? [{ message_id: "current-bot", object_type: "video", model_type: modelId }] : []);
    if (url.pathname.endsWith("/messages")) {
      const messages = ready && dispatched ? [owner, bot] : [owner]; return Response.json({ messages, pagination: { page: 1, page_size: 10,
        total_count: messages.length, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (url.pathname.endsWith("/current-echo")) return Response.json(owner);
    if (url.pathname.endsWith("/current-bot")) return Response.json(bot);
    throw new Error("Unexpected synthetic native route");
  };
  const access = (isCurrent: boolean) => async (_attempt: string, modelId: string,
    parameters: Readonly<Record<string, unknown>>): Promise<ModelAccessResult> => {
    now += 1000; costs.push({ ...parameters }); const selected = isCurrent && !options.stale ? current : profile;
    return { catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT", catalog_version: selected.registry.catalog_version,
      model_id: modelId, ai_name: "kling", model_type: modelId, account_read_live: true, parameter_keys: Object.keys(parameters).sort(),
      parameters_redacted: true, access: !options.deny, cost: null, discount_cost: null, free_remaining_generations: null,
      limit: null, show_warning: false, observed_at: new Date(now).toISOString() };
  };
  const service = new OwnerKlingT2vGenerationService({ catalogDirectory: directory, currentCatalogDirectory: directory, binding, linkService: links,
    resolveSubscription: async () => { now += 1000; return { active: true, plan_type: "PAID", end_date: null, end_date_kind: null }; },
    resolveModelAccess: access(false), resolveCurrentModelAccess: access(true),
    resolveChatClient: () => new SyntxChatHttpClient({ credentialBroker: { async useCredential(use) { return use("synthetic-kling-current"); } },
      fetchImpl, requestTimeoutMs: 1000 }), now: () => now, wait: async () => { now += 1000; }, videoTimeoutMs: options.pending ? 20 : 1000 });
  return { service, requests, costs, ready() { ready = true; } };
}

test("actual current Kling SDK drives finite duration, 4K/multi-shot and fractional temperature through current quote, sealed native POST and owned GET", async () => {
  for (const controls of [{ ...base }, { ...base, video_duration: 5.375 }, { ...base, version: "2.5", mode: "hd", native_audio: false, temperature: 0.375 }]) {
    const input: Record<string, unknown> = { ...controls }; if (input.version !== "3.0") delete input.multi_shots;
    const state = await fixture(), server = new McpServer({ name: "kling-current-sdk", version: "1" });
    registerSyntxOwnerKlingT2vTools(server, { service: state.service });
    const client = new Client({ name: "kling-current-sdk-client", version: "1" }), [caller, host] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(host); await client.connect(caller);
      const source = await client.callTool({ name: SYNTX_OWNER_GET_KLING_T2V_SOURCE_TOOL_NAME, arguments: { model_id: "kling_text2video" } });
      assert.equal((source.structuredContent as { current_controls: { status: string } }).current_controls.status, "FORM_SOURCE_REVIEWED");
      const { attemptId, ...fields } = input;
      const args = { ...fields, model_id: "kling_text2video", link_attempt_id: attemptId };
      const listed = (await client.listTools()).tools.find(tool => tool.name === SYNTX_OWNER_GENERATE_KLING_T2V_TOOL_NAME)!;
      const validate = new AjvJsonSchemaValidator().getValidator(listed.inputSchema as Parameters<AjvJsonSchemaValidator["getValidator"]>[0]);
      assert.equal(validate(args).valid, true);
      assert.equal(validate({ ...args, version: "2.6", mode: "standart", native_audio: true, temperature: 0.375 }).valid, false);
      const generated = await client.callTool({ name: SYNTX_OWNER_GENERATE_KLING_T2V_TOOL_NAME, arguments: args });
      assert.equal(generated.isError, undefined, JSON.stringify({ generated, requests: state.requests,
        recovery: state.service.listRecoveries(ATTEMPT) }));
      assert.equal((generated.structuredContent as { variant_id: string }).variant_id, KLING_T2V_CURRENT_VARIANT);
      const expectedCost = { version: input.version, mode: input.mode, video_duration: input.video_duration, native_audio: input.native_audio };
      assert.deepEqual(state.costs, [expectedCost, expectedCost]);
      const posted = state.requests.filter(r => r.method === "POST" && r.path.endsWith("video/generate"));
      assert.equal(posted.length, 1);
      const { attemptId: _attempt, prompt, ...settings } = input;
      assert.deepEqual(posted[0]!.body, { chat_id: "kling-current-chat", prompt,
        settings: { file_urls: [], model_type: "kling_text2video", ...settings } });
    } finally { await client.close(); await server.close(); await state.service.close(); }
  }
});

test("current Kling denied/stale access and recovery stay isolated from the legacy engine and never repeat POST", async () => {
  for (const options of [{ deny: true }, { stale: true }]) {
    const state = await fixture(options);
    try { await assert.rejects(state.service.generate({ model_id: "kling_text2video", ...base }), { code: "MODEL_ACCESS_UNAVAILABLE" });
      assert.equal(state.requests.some(r => r.method === "POST"), false);
    } finally { await state.service.close(); }
  }
  const state = await fixture({ pending: true });
  try {
    const unknown = await state.service.generate({ model_id: "kling_text2video", ...base }).catch(error => error as { code: string; recovery_id: string });
    assert.ok("code" in unknown && unknown.code === "OUTCOME_UNKNOWN");
    if (!("recovery_id" in unknown)) throw new Error("missing current recovery");
    assert.equal(state.service.listRecoveries(ATTEMPT)[0]?.variant_id, KLING_T2V_CURRENT_VARIANT);
    state.ready();
    const result = await state.service.reconcile({ attemptId: ATTEMPT, model_id: "kling_text2video", recovery_id: unknown.recovery_id });
    assert.equal(result.variant_id, KLING_T2V_CURRENT_VARIANT);
    assert.equal(state.requests.filter(r => r.method === "POST" && r.path.endsWith("video/generate")).length, 1);
  } finally { await state.service.close(); }
});

test("current Kling O1 keeps version absent from wire and quote rather than serializing historical literal1.6", async () => {
  const current = createOwnerKlingO1T2vCurrentProfile(directory), executor = new GenerationContractExecutorV2(current.registry, current.catalog);
  const fields = { prompt: base.prompt, mode: "hd", aspect_ratio: "9:16", video_duration: 5.375 };
  const normalized = current.normalizeGenerationInput({ attemptId: ATTEMPT, ...fields });
  const prepared = executor.prepare({ model_id: current.modelId, operation_id: current.operationId, variant_id: current.variantId,
    catalog_version: current.registry.catalog_version, parameters: normalized.parameters });
  assert.deepEqual(current.costParameterFields, ["mode", "video_duration"]);
  assert.equal(Object.hasOwn(prepared.settings, "version"), false);
  assert.equal(Object.hasOwn(current.registry.contracts[0]!.cost_parameter_bindings!, "version"), false);
  assert.throws(() => current.normalizeGenerationInput({ attemptId: ATTEMPT, ...fields, version: "1.6" }));
  const f = await fixture({ o1: true }), server = new McpServer({ name: "kling-o1-current", version: "1" });
  registerSyntxOwnerKlingT2vTools(server, { service: f.service });
  const client = new Client({ name: "kling-o1-current", version: "1" }), [caller, host] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(host); await client.connect(caller);
    const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_KLING_T2V_TOOL_NAME,
      arguments: { model_id: "kling_o1_text2video", link_attempt_id: ATTEMPT, ...fields } });
    assert.equal(result.isError, undefined, JSON.stringify(result)); assert.equal((result.structuredContent as { variant_id: string }).variant_id, KLING_O1_T2V_CURRENT_VARIANT);
    assert.deepEqual(f.costs, [{ mode: "hd", video_duration: 5.375 }, { mode: "hd", video_duration: 5.375 }]);
    const posts = f.requests.filter(r => r.path.endsWith("video/generate")); assert.equal(posts.length, 1);
    assert.deepEqual(posts[0]!.body, { chat_id: "kling-current-chat", prompt: base.prompt,
      settings: { file_urls: [], native_audio: false, model_type: "kling_o1_text2video", mode: "hd", aspect_ratio: "9:16", video_duration: 5.375 } });
  } finally { await client.close(); await server.close(); await f.service.close(); }
});


test("source manual finite duration branches preserve decimals while historical dropdown and measured branches remain closed",()=>{
 const manual=createOwnerKlingT2vCurrentProfile(directory,true);
 const executor=new GenerationContractExecutorV2(manual.registry,manual.catalog);
 for(const version of ["3.0","3.0-turbo"])for(const duration of [3,5.375,15]){
  const {multi_shots:_unused,...plain}=base;
  const n=manual.normalizeGenerationInput({...plain,mode:"hd",version,video_duration:duration,...(version==="3.0-turbo"?{}:{multi_shots:true})});
  const p=executor.prepare({model_id:manual.modelId,operation_id:manual.operationId,catalog_version:manual.registry.catalog_version,variant_id:manual.variantId,parameters:n.parameters});
  assert.equal(p.settings.video_duration,duration);
 }
 for(const duration of [NaN,Infinity,2.99,15.01])assert.throws(()=>manual.normalizeGenerationInput({...base,video_duration:duration}));
 const {multi_shots:_omitted,...withoutShots}=base;
 assert.equal(Object.hasOwn(manual.normalizeGenerationInput({...withoutShots,video_duration:5.375}).parameters,"multi_shots"),false);
 const i2v={model_id:"kling_image2video",prompt:base.prompt,reference_count:1,version:"3.0",mode:"hd",video_duration:5.375,native_audio:false};
 for(const version of ["3.0","3.0-turbo"])assert.equal(normalizeOwnerKlingI2vParameters({...i2v,version}).intent.video_duration,5.375);
 for(const version of ["2.5","2.5-turbo","2.6"])assert.throws(()=>normalizeOwnerKlingI2vParameters({...i2v,version}));
 const key={model_id:"kling_keyframes",version:"3.0",mode:"hd",video_duration:5.375,native_audio:false,aspect_ratio:null};
 assert.equal(normalizeOwnerKlingKeyframesParameters(key).intent.video_duration,5.375);
 for(const version of ["2.5-turbo","2.6"])assert.throws(()=>normalizeOwnerKlingKeyframesParameters({...key,version}));
 for(const model_id of ["kling_4_keyframes","kling_4_omni"] as const){
  const n=normalizeOwnerKling4Parameters({attemptId:ATTEMPT,model_id,prompt:base.prompt,version:"4.0",mode:"hd",aspect_ratio:"16:9",video_duration:5.375,native_audio:model_id==="kling_4_keyframes",reference_handles:[]});
  assert.equal(n.video_duration,5.375);
  assert.notEqual(getOwnerKling4EffectiveProfileHash(model_id,5.375),getOwnerKling4SourceProfile(model_id).source_sha256);
  assert.equal(getOwnerKling4EffectiveProfileHash(model_id,5),getOwnerKling4SourceProfile(model_id).source_sha256);
 }
});
