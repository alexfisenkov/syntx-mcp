import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import {
  buildMediaMcpConfig,
  main,
  parseArguments
} from "../scripts/print-media-mcp-config.mjs";

const SCRIPT_URL = pathToFileURL(fileURLToPath(new URL("../scripts/print-media-mcp-config.mjs", import.meta.url))).href;
const CONFIRM = "--confirm-enable-paid-tools";
const INCLUDE_KLING4 = "--include-kling4";

test("Kling 4 config is absent by default and appears only with its explicit opt-in", async () => {
  const defaults = buildMediaMcpConfig(SCRIPT_URL, process.execPath).mcpServers.syntx.env;
  assert.equal(Object.hasOwn(defaults, "SYNTX_OWNER_KLING4"), false);
  assert.equal(Object.hasOwn(defaults, "SYNTX_OWNER_KLING4_FFPROBE_PATH"), false);
  assert.equal(Object.hasOwn(defaults, "SYNTX_OWNER_KLING4_MAX_VIDEO_FILE_BYTES"), false);

  assert.deepEqual(parseArguments([CONFIRM, INCLUDE_KLING4]), { kind: "emit", includeKling4: true });
  const selected = buildMediaMcpConfig(SCRIPT_URL, process.execPath, { includeKling4: true }).mcpServers.syntx.env;
  assert.equal(selected.SYNTX_OWNER_KLING4, "1");
  assert.equal(selected.SYNTX_OWNER_KLING4_FFPROBE_PATH, "<absolute path to trusted ffprobe executable>");
  assert.equal(selected.SYNTX_OWNER_KLING4_MAX_VIDEO_FILE_BYTES, "67108864");

  const stdout = [], stderr = [];
  assert.equal(await main([CONFIRM, INCLUDE_KLING4], { entryUrl: SCRIPT_URL, nodeExecutable: process.execPath,
    writeStdout: (text) => stdout.push(text), writeStderr: (text) => stderr.push(text) }), 0);
  assert.equal(stderr.join(""), "");
  assert.equal(JSON.parse(stdout.join("")).mcpServers.syntx.env.SYNTX_OWNER_KLING4, "1");
});

test("Kling 4 selection never bypasses the existing paid-tools confirmation", async () => {
  assert.throws(() => parseArguments([INCLUDE_KLING4]));
  assert.throws(() => parseArguments([CONFIRM, INCLUDE_KLING4, INCLUDE_KLING4]));
  const stdout = [], stderr = [];
  assert.equal(await main([INCLUDE_KLING4], { entryUrl: SCRIPT_URL,
    writeStdout: (text) => stdout.push(text), writeStderr: (text) => stderr.push(text) }), 2);
  assert.equal(stdout.join(""), "");
  assert.equal(stderr.join(""), "MEDIA_MCP_CONFIG_ARGUMENTS_INVALID\n");
});

test("installed K4 startup env preserves the existing Veo probe override", async () => {
  const checker = readFileSync(new URL("../scripts/check-package-install.mjs", import.meta.url), "utf8");
  const start = checker.indexOf("async function assertInstalledMediaMcpConfig(");
  const end = checker.indexOf("\nasync function assertInstalledSyntxMaintenanceResources", start);
  assert.ok(start >= 0 && end > start);
  const checkerSource = checker.slice(start, end).trim();
  const packageRoot = join(tmpdir(), "syntx-config-selected-kling4-fixture");
  const cliPath = join(packageRoot, "scripts", "print-media-mcp-config.mjs");
  const defaultConfig = buildMediaMcpConfig(pathToFileURL(cliPath).href, process.execPath);
  const k4Config = buildMediaMcpConfig(pathToFileURL(cliPath).href, process.execPath, { includeKling4: true });
  const veoprofix = "/synthetic/installed-checker/ffprobe-fixture";
  let childProgram;
  const run = async (_command, args) => {
    if (args.length === 1) return { stdout: "Without the exact confirmation flag\n", stderr: "" };
    if (args[1] === CONFIRM && args.length === 2) return { stdout: JSON.stringify(defaultConfig), stderr: "" };
    if (args[1] === CONFIRM && args[2] === INCLUDE_KLING4) return { stdout: JSON.stringify(k4Config), stderr: "" };
    const evalIndex = args.indexOf("--eval");
    assert.ok(evalIndex >= 0, "the checker constructed its installed startup source");
    childProgram = args[evalIndex + 1];
    return { stdout: "media_config_cli=PASS enabled_flags=50 joint_tools=100 veo_omni_off_joint_tools=96 veo_omni_references_off_joint_tools=94 hailuo23_off_joint_tools=90 video2audio_off_joint_tools=95 hailuo_live_off_joint_tools=96 default_off_luma_tools=0 default_off_hailuo01_tools=0 default_off_hailuo01_director_tools=0 default_off_hailuo23_tools=0 default_off_video2audio_tools=0 default_off_kling_tools=0 default_off_veo_tools=0 default_off_veo_omni_t2v_tools=0 default_off_veo_omni_reference_tools=0 default_off_grok_t2v_tools=0 network=0 auth_calls=0 probe_calls=0 tool_calls=0 generation_posts=0 close=CLOSED pid_null=true stderr=0\n", stderr: "" };
  };
  class PackageSmokeError extends Error {}
  const installedChecker = runInNewContext(`(${checkerSource})`, {
    process: { execPath: process.execPath, platform: process.platform }, join, run,
    realpath: async (path) => path, PackageSmokeError
  });
  await installedChecker(packageRoot, join(tmpdir(), "syntx-config-selected-kling4-consumer"));
  assert.equal(typeof childProgram, "string");
  const selectedCall = childProgram.match(/const kling4On=await runList\((\{.*?\}),auditKling4On\);/u);
  assert.ok(selectedCall, "the selected K4 environment is passed to the actual generated runList call");
  let receivedEnv;
  await runInNewContext(`(async()=>runList(${selectedCall[1]},auditKling4On))()`, {
    installedCfg: { env: { SYNTX_OWNER_KLING4: undefined,
      SYNTX_OWNER_VEO_OMNI_REFERENCES_FFPROBE_PATH: veoprofix } },
    k4cfg: k4Config.mcpServers.syntx,
    process: { execPath: process.execPath },
    auditKling4On: "synthetic-kling4-audit",
    runList: async (env) => { receivedEnv = env; return { names: [], count: 0 }; }
  });
  assert.equal(receivedEnv.SYNTX_OWNER_KLING4, "1");
  assert.equal(receivedEnv.SYNTX_OWNER_KLING4_FFPROBE_PATH, process.execPath);
  assert.equal(receivedEnv.SYNTX_OWNER_KLING4_MAX_VIDEO_FILE_BYTES, "67108864");
  assert.equal(receivedEnv.SYNTX_OWNER_VEO_OMNI_REFERENCES_FFPROBE_PATH, veoprofix);
});
