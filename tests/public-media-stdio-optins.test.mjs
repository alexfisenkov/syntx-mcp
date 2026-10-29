import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildMediaMcpConfig } from "../scripts/print-media-mcp-config.mjs";

const OWNER_STDIO_PATH = fileURLToPath(new URL("../dist/src/transports/stdio-owner.js", import.meta.url));
const CONFIG_SCRIPT_PATH = fileURLToPath(new URL("../scripts/print-media-mcp-config.mjs", import.meta.url));
const EXPANDED_MODEL_IDS = ["flux3_t2v", "happy_horse_t2v", "seedance-1.5-pro", "seedance_pro", "seedance_pro-fast", "text2video-4.5"];
const EXPANDED_TOOLS = ["syntx_owner_get_expanded_t2v_parameters", "syntx_owner_generate_expanded_t2v",
  "syntx_owner_reconcile_expanded_t2v", "syntx_owner_list_expanded_t2v_recoveries"];
const UPDATE_TOOLS = ["syntx_update_check", "syntx_update_apply", "syntx_update_rollback"];
const EXISTING_VIDEO_READER = "syntx_owner_get_existing_video_recovery";
const MEDIA_COVERAGE_TOOL = "syntx_get_media_coverage";
const TIMEOUT_MS = 20_000;

function withTimeout(promise, timeoutMs, code) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(code)), timeoutMs); })])
    .finally(() => clearTimeout(timer));
}

test("all-supported plus self-update generated config registers update and existing-reader tools in fresh owner stdio", async () => {
  const temp = mkdtempSync(join(tmpdir(), "syntx-public-media-stdio-optins-"));
  chmodSync(temp, 0o700);
  const loaderPath = join(temp, "network-block.mjs");
  writeFileSync(loaderPath,
    "let calls=0;globalThis.fetch=(..._args)=>{calls++;throw new Error('OFFLINE_STDIO_FETCH_BLOCKED')};process.on('exit',code=>{try{process.stderr.write('PUBLIC_MEDIA_STDIO_FETCHES='+calls+';EXIT_CODE='+code+'\\n')}catch{}});\n",
    { mode: 0o600 });

  const config = buildMediaMcpConfig(pathToFileURL(CONFIG_SCRIPT_PATH).href, process.execPath,
    { includeAllSupportedMedia: true, includeSelfUpdate: true });
  const serverConfig = config.mcpServers.syntx;
  const childEnv = { ...serverConfig.env, PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
  for (const [key, value] of Object.entries(childEnv)) if (value === "<uploaded|hidden>") childEnv[key] = "uploaded";
  childEnv.SYNTX_MEDIA_FFPROBE_PATH = process.execPath;
  childEnv.SYNTX_MEDIA_FFMPEG_PATH = process.execPath;
  childEnv.SYNTX_SELF_UPDATE_BOOTSTRAPPED = "1";
  const familyBinaryPaths = Object.keys(childEnv).filter((key) => key.startsWith("SYNTX_OWNER_") && /_(?:FFPROBE|FFMPEG)_PATH$/u.test(key));
  assert.deepEqual(familyBinaryPaths, []);
  assert.equal(Object.keys(childEnv).filter((key) => /^SYNTX_MEDIA_(?:FFPROBE|FFMPEG)_PATH$/u.test(key)).length, 2);
  assert.equal(childEnv.SYNTX_OWNER_EXISTING_VIDEO_RECOVERY, "1");
  assert.equal(childEnv.SYNTX_SELF_UPDATE, "1");
  assert.equal(childEnv.SYNTX_SELF_UPDATE_BOOTSTRAPPED, "1");
  assert.equal(Object.keys(childEnv).some((key) => /(?:AUTH_KEY|AUTH_PROFILE|TOKEN|BEARER)/iu.test(key)), false);
  assert.equal(Object.values(childEnv).some((value) => typeof value === "string" && value.startsWith("<")), false);

  const client = new Client({ name: "public-media-stdio-optins-test", version: "1.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ["--import", pathToFileURL(loaderPath).href, OWNER_STDIO_PATH], cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: childEnv, stderr: "pipe" });
  let stderr = "";
  let childClosed = false;
  let resolveClosed;
  const closed = new Promise((resolve) => { resolveClosed = resolve; });
  transport.onclose = () => { childClosed = true; resolveClosed(); };
  transport.stderr?.on("data", (chunk) => { stderr += Buffer.from(chunk).toString("utf8"); });

  try {
    await withTimeout(client.connect(transport), TIMEOUT_MS, "PUBLIC_MEDIA_STDIO_INITIALIZE_TIMEOUT");
    const listed = await withTimeout(client.listTools(), TIMEOUT_MS, "PUBLIC_MEDIA_STDIO_TOOLS_LIST_TIMEOUT");
    const names = new Set(listed.tools.map((tool) => tool.name));
    for (const name of [...UPDATE_TOOLS, EXISTING_VIDEO_READER, MEDIA_COVERAGE_TOOL, ...EXPANDED_TOOLS]) {
      assert.equal(names.has(name), true, `missing required offline tool: ${name}`);
    }

    const coverageRows = [];
    for (const offset of [0, 100]) {
      const coverageResult = await withTimeout(client.callTool({ name: MEDIA_COVERAGE_TOOL,
        arguments: { offset, limit: 100, include_inactive: true } }), TIMEOUT_MS, "PUBLIC_MEDIA_STDIO_COVERAGE_TIMEOUT");
      assert.equal(coverageResult.isError, undefined);
      const page = coverageResult.structuredContent;
      assert.equal(page.total, 124);
      coverageRows.push(...page.items);
    }
    const existingReaderModels = coverageRows.filter((row) => row.mcp_tool_names.includes(EXISTING_VIDEO_READER));
    assert.equal(existingReaderModels.length, 14);
    assert.equal(existingReaderModels.every((row) => names.has(EXISTING_VIDEO_READER)), true);
    const existingKling4Rows = coverageRows.filter((row) => row.model_id === "kling_4_keyframes" || row.model_id === "kling_4_omni");
    assert.deepEqual(existingKling4Rows.map((row) => row.model_id).sort(), ["kling_4_keyframes", "kling_4_omni"]);
    assert.equal(existingKling4Rows.every((row) => row.mcp_tool_names.includes(EXISTING_VIDEO_READER)), true);
    const routeSnapshot = JSON.parse(readFileSync(resolve(process.cwd(), "catalog/media-coverage/owner-tool-routes-v3.json"), "utf8"));
    const kling4ReaderBinding = routeSnapshot.native_alias_bindings.find((binding) =>
      binding.operator_flag === "SYNTX_OWNER_EXISTING_VIDEO_RECOVERY" &&
      binding.public_model_ids.includes("kling_4_keyframes") && binding.public_model_ids.includes("kling_4_omni"));
    assert.match(kling4ReaderBinding?.operation_note ?? "", /^NO_REFERENCE_ONLY:/u);

    for (const modelId of EXPANDED_MODEL_IDS) {
      const sourceResult = await withTimeout(client.callTool({ name: EXPANDED_TOOLS[0], arguments: { model_id: modelId } }),
        TIMEOUT_MS, "PUBLIC_MEDIA_STDIO_SOURCE_READ_TIMEOUT");
      assert.equal(sourceResult.isError, undefined);
      const source = sourceResult.structuredContent;
      assert.equal(source.identity.model_id, modelId);
      assert.equal(source.source_pins.build_id, "1793202992");
      assert.equal(source.runtime_usable, false);
      assert.equal(source.dispatch_allowed, false);
    }

    await withTimeout(client.close(), 5_000, "PUBLIC_MEDIA_STDIO_CLIENT_CLOSE_TIMEOUT");
    await withTimeout(closed, 5_000, "PUBLIC_MEDIA_STDIO_CHILD_CLOSE_TIMEOUT");
    const marker = stderr.match(/^PUBLIC_MEDIA_STDIO_FETCHES=(\d+);EXIT_CODE=(\d+)$/mu);
    assert.ok(marker, "missing offline-fetch/exit marker");
    assert.equal(Number(marker[1]), 0, "startup, tools/list, and source getter made no fetch requests");
    assert.equal(Number(marker[2]), 0, "owner stdio child exited successfully");
    assert.equal(transport.pid, null);
    assert.equal(stderr.replace(/^PUBLIC_MEDIA_STDIO_FETCHES=\d+;EXIT_CODE=\d+\s*$/gmu, "").trim(), "");
  } finally {
    try { await client.close(); } catch {}
    if (transport.pid !== null) { try { await transport.close(); } catch {} }
    rmSync(temp, { recursive: true, force: true });
  }
});
