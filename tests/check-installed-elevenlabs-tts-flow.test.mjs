import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as checker from "../scripts/check-installed-elevenlabs-tts-flow.mjs";

const TOOLS = [
  "syntx_get_elevenlabs_tts_parameters", "syntx_owner_list_elevenlabs_voice_references",
  "syntx_owner_generate_elevenlabs_tts", "syntx_owner_reconcile_elevenlabs_tts",
  "syntx_owner_list_elevenlabs_tts_recoveries", "syntx_owner_get_elevenlabs_tts_result_page"
];

test("installed ElevenLabs checker requires the packed TTS/runtime ABI and archived public catalog", () => {
  assert.ok(checker.ELEVENLABS_TTS_REQUIRED_PACKAGE_PATHS.includes("dist/src/index.js"));
  assert.ok(checker.ELEVENLABS_TTS_REQUIRED_PACKAGE_PATHS.includes("dist/src/mcp/owner-elevenlabs-tts-tools.js"));
  assert.ok(checker.ELEVENLABS_TTS_REQUIRED_PACKAGE_PATHS.includes("dist/src/adapter/syntx/owner-elevenlabs-audio-result.js"));
  assert.ok(checker.ELEVENLABS_TTS_REQUIRED_PACKAGE_PATHS.includes("catalog/public/sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json"));
  assert.equal(checker.assertElevenLabsTtsPackagePaths(new Set(checker.ELEVENLABS_TTS_REQUIRED_PACKAGE_PATHS)), true);
  assert.throws(() => checker.assertElevenLabsTtsPackagePaths(new Set()),
    (error) => error.code === "INSTALLED_ELEVENLABS_TTS_PACKAGE_CONTENT_MISSING");
});

test("installed TTS owner surface is default-off and opt-in is exactly six tools", () => {
  assert.deepEqual(checker.assertElevenLabsTtsToolNames([], false), { tool_count: 0 });
  assert.throws(() => checker.assertElevenLabsTtsToolNames([{ name: TOOLS[0] }], false),
    (error) => error.code === "INSTALLED_ELEVENLABS_TTS_DEFAULT_OFF_FAILED");
  assert.deepEqual(checker.assertElevenLabsTtsToolNames(TOOLS.map((name) => ({ name })), true), { tool_count: 6 });
  assert.throws(() => checker.assertElevenLabsTtsToolNames([...TOOLS.map((name) => ({ name })), { name: TOOLS[0] }], true),
    (error) => error.code === "INSTALLED_ELEVENLABS_TTS_TOOL_SET_MISMATCH");
});

test("installed TTS summary requires measured model, paging, recovery, lifecycle and no-network counters", () => {
  const proof = {
    status: "INSTALLED_STOCK_SDK_ELEVENLABS_TTS_CALLTOOL_PASS", node_version: "24.21.0", sdk_version: "1.32.1",
    clean_installed_package: true, default_tools: 0, opt_in_tools: 6, model_branches_checked: 4, control_cases_checked: 884,
    generation_posts: 7, result_messages: 7, artifacts_seen: 85, page_reads: 1, page_size: 64, page_observations: 80,
    page_io_delta: 0, unknown_recoveries: 1, recovery_get_only: true, replay_posts: 0, revoke_drain: "PASS", eof_drain: "PASS",
    auth_cleanup: "PASS", default_child_close: "CLOSED", opt_in_child_close: "CLOSED", default_child_pid_null: true,
    opt_in_child_pid_null: true, default_stderr_bytes: 0, opt_in_stderr_bytes: 0, default_network_calls: 0,
    opt_in_network_calls: 0, authenticated_network_calls: 0, billing_calls: 0, voice_provider_ids_exposed: 0,
    fresh_preflight_operations: 14, source_catalog_version: "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json",
    runtime_usable: false, backend_acceptance: "UNPROVEN", provider_terminal_status: "UNPROVEN"
  };
  const summary = checker.formatElevenLabsTtsInstalledSummary(proof);
  for (const counter of ["models=4", "controls=884", "generation_posts=7", "page_observations=80", "page_io_delta=0",
    "recovery_get_only=true", "replay_posts=0", "voice_provider_ids_exposed=0", "fresh_preflights=14",
    "eof_drain=PASS", "provider_terminal_status=UNPROVEN"]) assert.ok(summary.includes(counter), counter);
  assert.throws(() => checker.formatElevenLabsTtsInstalledSummary({ ...proof, replay_posts: 1 }),
    (error) => error.code === "INSTALLED_ELEVENLABS_TTS_SUMMARY_INVALID");
});

test("package smoke invokes and prints the installed ElevenLabs flow as a mandatory gate", async () => {
  const source = await readFile(new URL("../scripts/check-package-install.mjs", import.meta.url), "utf8");
  assert.match(source, /assertInstalledElevenLabsTtsFlow/u);
  assert.match(source, /formatElevenLabsTtsInstalledSummary/u);
  assert.match(source, /\$\{installedElevenLabsTtsFlow\}/u);
});

test("installed voice discovery exact paging/facets stay read-only and fixed TTS language remains model-scoped", async () => {
  const [{Client},{InMemoryTransport},r,s,parameters,tools]=await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),import("@modelcontextprotocol/sdk/inMemory.js"),
    import("../dist/src/runtime/observed-owner-runtime.js"),import("../dist/src/mcp/server.js"),
    import("../dist/src/application/owner-elevenlabs-generation-parameters.js"),import("../dist/src/mcp/owner-elevenlabs-tts-tools.js")]);
  let network=0;const runtime=r.createObservedOwnerRuntime({ownerElevenLabsTtsEnabled:true,fetchImpl:async()=>{network++;throw new Error("NETWORK_DISABLED");}});
  const server=s.createMcpServer(runtime.application,runtime.serverOptions),client=new Client({name:"voice-helper-schema",version:"1"});const[a,b]=InMemoryTransport.createLinkedPair();
  try{await server.connect(b);await client.connect(a);const listed=(await client.listTools()).tools;
    assert.equal(checker.assertElevenLabsTtsToolSurface(listed,true,{parameters,tools}).control_cases,884);
    const input=tools.OWNER_ELEVENLABS_TTS_TOOL_INPUT_SCHEMAS.list_voices,attempt="link_voice_checker_current_0123456789";
    const base={link_attempt_id:attempt,page:1,page_size:20,search:"Synthetic",gender:"female",age:"adult",use_case:"narration",accent:"neutral",language:"en",sort_by:"name",sort_direction:"asc"};
    assert.equal(input.safeParse(base).success,true);
    for(const bad of [{...base,page:2},{...base,page_size:21},{...base,cursor:"foreign"},{...base,search:"x".repeat(501)},{...base,gender:"x".repeat(257)},{...base,voice_id:"private"}])assert.equal(input.safeParse(bad).success,false);
    const generate=tools.OWNER_ELEVENLABS_TTS_TOOL_INPUT_SCHEMAS.generate;
    const tuple={link_attempt_id:attempt,model_id:"eleven_v4",mode:"text_to_speech",prompt:"A synthetic control",voice_ref:"owner_elevenlabs_voice_00000000-0000-4000-8000-000000000001",stability:0.5,similarity_boost:0.5};
    assert.equal(generate.safeParse({...tuple,language_code:"auto"}).success,true);
    assert.equal(generate.safeParse({...tuple,language_code:"ru"}).success,false);
    assert.equal(generate.safeParse({...tuple,model_id:"eleven_v3",language_code:"auto"}).success,false);
    for(const mutate of [a=>{a[1].inputSchema.properties.page.const=2;},a=>{a[1].outputSchema.properties.filter_options.additionalProperties=true;},a=>{a[1].outputSchema.properties.voices.maxItems=21;},a=>{a[1].inputSchema.properties.provider_voice_id={type:"string"};},a=>{a[2].inputSchema.oneOf[2].properties.language_code={enum:["auto","ru"]};}]){
      const changed=TOOLS.map(name=>structuredClone(listed.find(t=>t.name===name)));mutate(changed);
      assert.throws(()=>checker.assertElevenLabsTtsToolSurface(changed,true,{parameters,tools}),e=>e instanceof checker.ElevenLabsTtsInstalledCheckError);
    }
    assert.equal(network,0);
  }finally{await client.close();await server.close();await runtime.ownerElevenLabsTtsLifecycle?.close();await runtime.authStore.close();}
});
