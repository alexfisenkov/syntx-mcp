import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as checker from "../scripts/check-installed-wan-t2v-flow.mjs";

const MODELS = ["wan_26_t2v", "wan_27_t2v"];
const TOOL_NAMES = ["syntx_get_wan_t2v_parameters", "syntx_owner_generate_wan_t2v_video",
  "syntx_owner_reconcile_wan_t2v_video", "syntx_owner_list_wan_t2v_recoveries", "syntx_owner_get_wan_t2v_result_page"];

test("installed WAN T2V checker gates the compiled public/service/runtime modules and exact B066/1b48 archives", () => {
  assert.ok(checker.WAN_T2V_REQUIRED_PACKAGE_PATHS.includes("dist/src/index.js"));
  assert.ok(checker.WAN_T2V_REQUIRED_PACKAGE_PATHS.includes("dist/src/mcp/owner-wan-t2v-video-tools.js"));
  assert.ok(checker.WAN_T2V_REQUIRED_PACKAGE_PATHS.includes("catalog/public/sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json"));
  assert.ok(checker.WAN_T2V_REQUIRED_PACKAGE_PATHS.includes("catalog/settings/v2/sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json"));
  assert.equal(checker.assertWanT2vPackagePaths(new Set(checker.WAN_T2V_REQUIRED_PACKAGE_PATHS)), true);
  assert.throws(() => checker.assertWanT2vPackagePaths(new Set()), (error) => error.code === "INSTALLED_WAN_T2V_PACKAGE_CONTENT_MISSING");
});

test("installed WAN T2V surface is default-off and opt-in has exactly five closed tool schemas", () => {
  assert.deepEqual(checker.assertWanT2vToolNames([], false), { tool_count: 0 });
  assert.throws(() => checker.assertWanT2vToolNames([{ name: TOOL_NAMES[0] }], false),
    (error) => error.code === "INSTALLED_WAN_T2V_DEFAULT_OFF_FAILED");
  assert.deepEqual(checker.assertWanT2vToolNames(TOOL_NAMES.map((name) => ({ name })), true), { tool_count: 5 });
  assert.throws(() => checker.assertWanT2vToolNames([...TOOL_NAMES.map((name) => ({ name })), { name: TOOL_NAMES[0] }], true),
    (error) => error.code === "INSTALLED_WAN_T2V_TOOL_SET_MISMATCH");
});

test("strict WAN T2V default-off flag accepts only unset, empty, zero, or one", () => {
  const reader = (value) => {
    if (value === undefined || value === "" || value === "0") return false;
    if (value === "1") return true;
    throw new Error("invalid flag");
  };
  assert.equal(checker.assertWanT2vFlagReader({ readOwnerWanT2vVideosFlag: reader }), true);
});

test("installed WAN T2V public barrel allows source DTO/tool API but rejects service internals", () => {
  const parameters = { getOwnerWanT2vGenerationParametersSource() {}, normalizeOwnerWanT2vGenerationParameters() {},
    OWNER_WAN_T2V_GENERATION_MODEL_IDS: MODELS, OwnerWanT2vGenerationParametersError: class {} };
  const tools = { OWNER_WAN_T2V_TOOL_NAMES: TOOL_NAMES, OWNER_WAN_T2V_TOOL_INPUT_SCHEMAS: {}, OWNER_WAN_T2V_TOOL_OUTPUT_SCHEMAS: {},
    registerSyntxOwnerWanT2vVideoTools() {}, SYNTX_GET_WAN_T2V_PARAMETERS_TOOL_NAME: TOOL_NAMES[0],
    SYNTX_OWNER_GENERATE_WAN_T2V_VIDEO_TOOL_NAME: TOOL_NAMES[1], SYNTX_OWNER_RECONCILE_WAN_T2V_VIDEO_TOOL_NAME: TOOL_NAMES[2],
    SYNTX_OWNER_LIST_WAN_T2V_RECOVERIES_TOOL_NAME: TOOL_NAMES[3], SYNTX_OWNER_GET_WAN_T2V_RESULT_PAGE_TOOL_NAME: TOOL_NAMES[4] };
  const server = { createMcpServer() {} }, runtime = { createObservedOwnerRuntime() {} };
  const modules = { parameters, tools, server, runtime };
  const api = { ...parameters, ...tools, ...server, ...runtime };
  assert.equal(checker.assertWanT2vPublicExports(api, modules), true);
  assert.throws(() => checker.assertWanT2vPublicExports({ ...api, OwnerWanT2vGenerationService: class {} }, modules),
    (error) => error.code === "INSTALLED_WAN_T2V_PRIVATE_EXPORT_LEAK");
});

test("summary formatter requires every field from the measured proof and preserves unknown/provider boundaries", () => {
  const proof = {
    status: "INSTALLED_STOCK_SDK_WAN_T2V_CALLTOOL_PASS", node_version: "24.21.0", sdk_version: "1.32.1", clean_installed_package: true,
    default_tools: 0, opt_in_tools: 5, model_branches_checked: 2, parameter_schema_cases: 480,
    generation_posts: 5, result_messages: 4, artifacts_seen: 82, page_reads: 1, page_size: 64, page_observations: 80,
    page_io_delta: 0, unknown_recoveries: 1, recovery_get_only: true, replay_posts: 0,
    revoke_drain: "PASS", eof_drain: "PASS", auth_cleanup: "PASS", default_child_close: "CLOSED", opt_in_child_close: "CLOSED",
    default_child_pid_null: true, opt_in_child_pid_null: true, default_stderr_bytes: 0, opt_in_stderr_bytes: 0,
    default_network_calls: 0, opt_in_network_calls: 0, authenticated_network_calls: 0, billing_calls: 0,
    source_catalog_version: "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json",
    source_settings_version: "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json",
    runtime_usable: false, dispatch_allowed: false, backend_acceptance: "UNPROVEN", provider_terminal_status: "UNPROVEN"
  };
  const output = checker.formatWanT2vInstalledSummary(proof);
  for (const field of ["model_branches=2", "parameter_schema_cases=480", "generation_posts=5", "page_observations=80",
    "page_io_delta=0", "recovery_get_only=true", "replay_posts=0", "eof_drain=PASS", "provider_terminal_status=UNPROVEN"]) {
    assert.ok(output.includes(field), field);
  }
  assert.throws(() => checker.formatWanT2vInstalledSummary({ ...proof, replay_posts: 1 }),
    (error) => error.code === "INSTALLED_WAN_T2V_SUMMARY_INVALID");
});

test("package smoke makes installed WAN T2V proof and summary mandatory", async () => {
  const source = await readFile(new URL("../scripts/check-package-install.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("assertInstalledWanT2vFlow"), true);
  assert.equal(source.includes("formatWanT2vInstalledSummary"), true);
  assert.equal(source.includes("${installedWanT2vFlow}"), true);
});


test("installed WAN exact current schema admits only scoped audio/adaptive additions and retains legacy pins", async () => {
  const [{ Client }, { InMemoryTransport }, runtimeModule, serverModule, parameters, wan30Parameters, tools] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"), import("@modelcontextprotocol/sdk/inMemory.js"),
    import("../dist/src/runtime/observed-owner-runtime.js"), import("../dist/src/mcp/server.js"),
    import("../dist/src/application/owner-wan-t2v-generation-parameters.js"), import("../dist/src/application/owner-wan30-t2v-generation-parameters.js"),
    import("../dist/src/mcp/owner-wan-t2v-video-tools.js")
  ]);
  let fetches=0;
  const runtime=runtimeModule.createObservedOwnerRuntime({ownerWanT2vVideosEnabled:true,fetchImpl:async()=>{fetches++;throw new Error("NETWORK_DISABLED");}});
  const server=serverModule.createMcpServer(runtime.application,runtime.serverOptions),client=new Client({name:"wan-checker-current-test",version:"1"});
  const [caller,host]=InMemoryTransport.createLinkedPair();
  try {
    await server.connect(host);await client.connect(caller);
    const listed=(await client.listTools()).tools, modules={parameters,tools};
    assert.deepEqual(checker.assertWanT2vToolSurface(listed,true,modules),{tool_count:5,closed_schemas:true,model_branches:3,parameter_schema_cases:480});
    assert.equal(checker.assertWanT2vSourceContract({...parameters,...wan30Parameters},tools).models,3);
    for(const mutate of [
      a=>{a[0].outputSchema.properties.unreviewed_source={};},
      a=>{delete a[0].outputSchema.properties.current_audio_reference_source;},
      a=>{a[0].outputSchema.oneOf[0].properties.current_audio_reference_source.properties.form_sha256.const="sha256:"+"0".repeat(64);},
      a=>{a[0].outputSchema.oneOf[1].properties.current_adaptive_source.additionalProperties=true;},
      a=>{a[1].inputSchema.properties.audio_handle.pattern=".*";},
      a=>{a[1].inputSchema.oneOf[1].properties.parameters.properties.native_audio.const=true;},
      a=>{a[1].inputSchema.oneOf[2].properties.parameters.properties.aspect_ratio.enum.pop();},
      a=>{a[1].annotations.idempotentHint=true;}
    ]) {
      const altered=TOOL_NAMES.map(name=>structuredClone(listed.find(tool=>tool.name===name)));
      mutate(altered);
      assert.throws(()=>checker.assertWanT2vToolSurface(altered,true,modules),error=>error instanceof checker.WanT2vFlowInstalledCheckError);
    }
    for(const model_id of ["wan_26_t2v","wan_30_t2v"]){
      const reply=await client.callTool({name:TOOL_NAMES[0],arguments:{model_id}});
      assert.notEqual(reply.isError,true);
      const current=reply.structuredContent[model_id==="wan_30_t2v"?"current_adaptive_source":"current_audio_reference_source"];
      assert.ok(current);assert.equal(current.provider_acceptance??current.backend_acceptance,"UNPROVEN");
    }
    assert.equal(fetches,0);
  } finally {await client.close();await server.close();await runtime.ownerWanT2vLifecycle?.close();}
});
