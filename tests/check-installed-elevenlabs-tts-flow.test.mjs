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
