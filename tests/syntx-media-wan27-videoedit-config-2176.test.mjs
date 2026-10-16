import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import {
  buildMediaMcpConfig,
  INCLUDE_KLING4_FLAG,
  INCLUDE_WAN27_VIDEOEDIT_FLAG,
  main,
  PAID_TOOLS_CONFIRMATION_FLAG,
  parseArguments
} from "../scripts/print-media-mcp-config.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/print-media-mcp-config.mjs", import.meta.url));
const SCRIPT_URL = pathToFileURL(SCRIPT).href;
const NODE = process.execPath;
const WAN_ENV = "SYNTX_OWNER_WAN27_VIDEOEDIT";
const WAN_PROBE = "SYNTX_OWNER_WAN27_VIDEOEDIT_FFPROBE_PATH";
const WAN_MAX = "SYNTX_OWNER_WAN27_VIDEOEDIT_MAX_VIDEO_FILE_BYTES";

function config(options) {
  return buildMediaMcpConfig(SCRIPT_URL, NODE, options);
}

function envOf(value) {
  return value.mcpServers.syntx.env;
}

function runCli(args) {
  return spawnSync(NODE, [SCRIPT, ...args], { encoding: "utf8", timeout: 5000, windowsHide: true });
}

test("keeps paid-tool confirmation first and both optional groups omitted by default", () => {
  assert.equal(INCLUDE_WAN27_VIDEOEDIT_FLAG, "--include-wan27-videoedit");
  assert.deepEqual(parseArguments([PAID_TOOLS_CONFIRMATION_FLAG]), { kind: "emit" });
  assert.deepEqual(parseArguments([PAID_TOOLS_CONFIRMATION_FLAG, INCLUDE_KLING4_FLAG]), { kind: "emit", includeKling4: true });
  assert.deepEqual(parseArguments([PAID_TOOLS_CONFIRMATION_FLAG, INCLUDE_WAN27_VIDEOEDIT_FLAG]),
    { kind: "emit", includeWan27VideoEdit: true });
  assert.deepEqual(parseArguments([PAID_TOOLS_CONFIRMATION_FLAG, INCLUDE_WAN27_VIDEOEDIT_FLAG, INCLUDE_KLING4_FLAG]),
    { kind: "emit", includeKling4: true, includeWan27VideoEdit: true });

  const defaults = envOf(config());
  assert.equal(Object.hasOwn(defaults, "SYNTX_OWNER_KLING4"), false);
  assert.equal(Object.hasOwn(defaults, WAN_ENV), false);
});

test("accepts either optional flag order after first confirmation and preserves the legacy Kling-only shape", () => {
  assert.deepEqual(parseArguments([PAID_TOOLS_CONFIRMATION_FLAG, INCLUDE_KLING4_FLAG]),
    { kind: "emit", includeKling4: true });
  assert.deepEqual(parseArguments([PAID_TOOLS_CONFIRMATION_FLAG, INCLUDE_WAN27_VIDEOEDIT_FLAG]),
    { kind: "emit", includeWan27VideoEdit: true });
  assert.deepEqual(parseArguments([PAID_TOOLS_CONFIRMATION_FLAG, INCLUDE_KLING4_FLAG, INCLUDE_WAN27_VIDEOEDIT_FLAG]),
    { kind: "emit", includeKling4: true, includeWan27VideoEdit: true });
  assert.deepEqual(parseArguments([PAID_TOOLS_CONFIRMATION_FLAG, INCLUDE_KLING4_FLAG]),
    { kind: "emit", includeKling4: true });
});

test("rejects missing confirmation, duplicates, unknown flags, and mixed help selections", () => {
  for (const args of [
    [INCLUDE_KLING4_FLAG], [INCLUDE_WAN27_VIDEOEDIT_FLAG],
    [PAID_TOOLS_CONFIRMATION_FLAG, PAID_TOOLS_CONFIRMATION_FLAG],
    [PAID_TOOLS_CONFIRMATION_FLAG, INCLUDE_KLING4_FLAG, INCLUDE_KLING4_FLAG],
    [PAID_TOOLS_CONFIRMATION_FLAG, INCLUDE_WAN27_VIDEOEDIT_FLAG, INCLUDE_WAN27_VIDEOEDIT_FLAG],
    [PAID_TOOLS_CONFIRMATION_FLAG, "--unknown"], ["--help", INCLUDE_WAN27_VIDEOEDIT_FLAG],
    [INCLUDE_KLING4_FLAG, PAID_TOOLS_CONFIRMATION_FLAG], [INCLUDE_WAN27_VIDEOEDIT_FLAG, PAID_TOOLS_CONFIRMATION_FLAG],
    [INCLUDE_KLING4_FLAG, INCLUDE_WAN27_VIDEOEDIT_FLAG, PAID_TOOLS_CONFIRMATION_FLAG],
    [INCLUDE_WAN27_VIDEOEDIT_FLAG, PAID_TOOLS_CONFIRMATION_FLAG, INCLUDE_KLING4_FLAG, INCLUDE_KLING4_FLAG]
  ]) assert.throws(() => parseArguments(args));
  assert.deepEqual(parseArguments([]), { kind: "help" });
  assert.deepEqual(parseArguments(["--help"]), { kind: "help" });
});

test("builds a WAN-only or combined config without altering legacy Kling selection", () => {
  const defaults = envOf(config());
  const klingOnly = envOf(config({ includeKling4: true }));
  assert.equal(klingOnly.SYNTX_OWNER_KLING4, "1");
  assert.equal(klingOnly.SYNTX_OWNER_KLING4_FFPROBE_PATH, "<absolute path to trusted ffprobe executable>");
  assert.equal(Object.hasOwn(klingOnly, WAN_ENV), false);

  const wanOnly = envOf(config({ includeWan27VideoEdit: true }));
  assert.equal(wanOnly[WAN_ENV], "1");
  assert.equal(wanOnly[WAN_PROBE], "<absolute path to trusted ffprobe executable>");
  assert.equal(wanOnly[WAN_MAX], "67108864");
  assert.equal(Object.hasOwn(wanOnly, "SYNTX_OWNER_KLING4"), false);
  for (const [key, value] of Object.entries(defaults)) {
    if (![WAN_ENV, WAN_PROBE, WAN_MAX].includes(key)) assert.equal(wanOnly[key], value, key);
  }

  const combined = envOf(config({ includeKling4: true, includeWan27VideoEdit: true }));
  assert.equal(combined.SYNTX_OWNER_KLING4, "1");
  assert.equal(combined[WAN_ENV], "1");
  assert.equal(combined[WAN_PROBE], "<absolute path to trusted ffprobe executable>");
  assert.equal(combined[WAN_MAX], "67108864");
});

test("requires a nonempty plain options object with own data booleans only", () => {
  for (const options of [
    {}, { includeKling4: "true" }, { includeWan27VideoEdit: 1 }, { includeKling4: true, surprise: false },
    { includeKling4: true, includeWan27VideoEdit: "yes" }, [], Object.create(null), new Proxy({ includeWan27VideoEdit: true }, {})
  ]) assert.throws(() => config(options));
  let getterCalls = 0;
  const accessor = Object.defineProperty({}, "includeWan27VideoEdit", { enumerable: true, get() { getterCalls += 1; return true; } });
  assert.throws(() => config(accessor));
  assert.equal(getterCalls, 0);
  assert.equal(Object.hasOwn(envOf(config({ includeKling4: false })), "SYNTX_OWNER_KLING4"), false);
});

test("CLI emits the new env only after explicit confirmation and describes startup and local-media bounds", async () => {
  const denied = runCli([INCLUDE_WAN27_VIDEOEDIT_FLAG]);
  assert.equal(denied.status, 2);
  assert.equal(denied.stdout, "");
  assert.match(denied.stderr, /MEDIA_MCP_CONFIG_ARGUMENTS_INVALID/u);

  const accepted = runCli([PAID_TOOLS_CONFIRMATION_FLAG, INCLUDE_WAN27_VIDEOEDIT_FLAG]);
  assert.equal(accepted.status, 0, accepted.stderr);
  const parsed = JSON.parse(accepted.stdout);
  const env = envOf(parsed);
  assert.equal(env[WAN_ENV], "1");
  assert.equal(env[WAN_PROBE], "<absolute path to trusted ffprobe executable>");
  assert.equal(env[WAN_MAX], "67108864");
  assert.equal(Object.hasOwn(env, "SYNTX_OWNER_KLING4"), false);

  const both = runCli([PAID_TOOLS_CONFIRMATION_FLAG, INCLUDE_WAN27_VIDEOEDIT_FLAG, INCLUDE_KLING4_FLAG]);
  assert.equal(both.status, 0, both.stderr);
  const bothEnv = envOf(JSON.parse(both.stdout));
  assert.equal(bothEnv.SYNTX_OWNER_KLING4, "1");
  assert.equal(bothEnv[WAN_ENV], "1");

  let help = "";
  assert.equal(await main(["--help"], { writeStdout: text => { help += text; } }), 0);
  assert.match(help, /--include-wan27-videoedit/u);
  assert.match(help, /20 MiB/u);
  assert.match(help, /100 MiB/u);
  assert.match(help, /64 MiB/u);
  assert.match(help, /240–4096/u);
  assert.match(help, /already-trimmed 2–10 second video/u);
  assert.match(help, /no implicit crop/u);
  assert.match(help, /no enforceable provider cost cap/u);
  assert.match(help, /Startup only registers explicitly callable paid tools; it does not upload or generate automatically/u);
});
