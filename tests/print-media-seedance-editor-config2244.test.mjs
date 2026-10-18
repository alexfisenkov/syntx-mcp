import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import {
  buildMediaMcpConfig,
  INCLUDE_KLING4_FLAG,
  INCLUDE_SEEDANCE_EDITOR_FLAG,
  INCLUDE_WAN27_VIDEOEDIT_FLAG,
  main,
  PAID_TOOLS_CONFIRMATION_FLAG,
  parseArguments
} from "../scripts/print-media-mcp-config.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/print-media-mcp-config.mjs", import.meta.url));
const SCRIPT_URL = pathToFileURL(SCRIPT).href;
const NODE = process.execPath;
const EDITOR_ENV = "SYNTX_OWNER_SEEDANCE_EDITOR";
const EDITOR_PROBE = "SYNTX_OWNER_SEEDANCE_EDITOR_FFPROBE_PATH";
const EDITOR_MAX = "SYNTX_OWNER_SEEDANCE_EDITOR_MAX_VIDEO_FILE_BYTES";

function envOf(value) {
  return value.mcpServers.syntx.env;
}

function config(options) {
  return buildMediaMcpConfig(SCRIPT_URL, NODE, options);
}

function runCli(args) {
  return spawnSync(NODE, [SCRIPT, ...args], { encoding: "utf8", timeout: 5000, windowsHide: true });
}

test("Seedance Editor CLI group is independently opt-in behind first paid confirmation", async () => {
  assert.equal(INCLUDE_SEEDANCE_EDITOR_FLAG, "--include-seedance-editor");
  assert.deepEqual(parseArguments([PAID_TOOLS_CONFIRMATION_FLAG]), { kind: "emit" });
  assert.deepEqual(parseArguments([PAID_TOOLS_CONFIRMATION_FLAG, INCLUDE_SEEDANCE_EDITOR_FLAG]),
    { kind: "emit", includeSeedanceEditor: true });
  for (const [flags, selection] of [
    [[INCLUDE_KLING4_FLAG, INCLUDE_SEEDANCE_EDITOR_FLAG], { includeKling4: true, includeSeedanceEditor: true }],
    [[INCLUDE_WAN27_VIDEOEDIT_FLAG, INCLUDE_SEEDANCE_EDITOR_FLAG], { includeWan27VideoEdit: true, includeSeedanceEditor: true }],
    [[INCLUDE_KLING4_FLAG, INCLUDE_WAN27_VIDEOEDIT_FLAG, INCLUDE_SEEDANCE_EDITOR_FLAG],
      { includeKling4: true, includeWan27VideoEdit: true, includeSeedanceEditor: true }]
  ]) assert.deepEqual(parseArguments([PAID_TOOLS_CONFIRMATION_FLAG, ...flags]), { kind: "emit", ...selection });

  for (const args of [
    [INCLUDE_SEEDANCE_EDITOR_FLAG],
    [PAID_TOOLS_CONFIRMATION_FLAG, INCLUDE_SEEDANCE_EDITOR_FLAG, INCLUDE_SEEDANCE_EDITOR_FLAG],
    [PAID_TOOLS_CONFIRMATION_FLAG, "--unknown"],
    ["--help", INCLUDE_SEEDANCE_EDITOR_FLAG],
    [INCLUDE_SEEDANCE_EDITOR_FLAG, PAID_TOOLS_CONFIRMATION_FLAG]
  ]) assert.throws(() => parseArguments(args));

  const defaults = envOf(config());
  for (const key of [EDITOR_ENV, EDITOR_PROBE, EDITOR_MAX]) assert.equal(Object.hasOwn(defaults, key), false, key);

  const selected = envOf(config({ includeSeedanceEditor: true }));
  assert.equal(selected[EDITOR_ENV], "1");
  assert.equal(selected[EDITOR_PROBE], "<absolute path to trusted ffprobe executable>");
  assert.equal(selected[EDITOR_MAX], "67108864");
  assert.equal(Object.hasOwn(selected, "SYNTX_OWNER_KLING4"), false);
  assert.equal(Object.hasOwn(selected, "SYNTX_OWNER_WAN27_VIDEOEDIT"), false);
  assert.deepEqual(Object.keys(selected).filter(key => !Object.hasOwn(defaults, key)).sort(),
    [EDITOR_ENV, EDITOR_PROBE, EDITOR_MAX].sort());
  for (const [key, value] of Object.entries(defaults)) assert.equal(selected[key], value, key);
  for (const key of [EDITOR_ENV, EDITOR_PROBE, EDITOR_MAX]) {
    assert.equal(Object.hasOwn(envOf(config({ includeSeedanceEditor: false })), key), false, key);
  }

  const klingAndEditor = envOf(config({ includeKling4: true, includeSeedanceEditor: true }));
  assert.equal(klingAndEditor.SYNTX_OWNER_KLING4, "1");
  assert.equal(klingAndEditor[EDITOR_ENV], "1");
  assert.equal(Object.hasOwn(klingAndEditor, "SYNTX_OWNER_WAN27_VIDEOEDIT"), false);

  const wanAndEditor = envOf(config({ includeWan27VideoEdit: true, includeSeedanceEditor: true }));
  assert.equal(wanAndEditor.SYNTX_OWNER_WAN27_VIDEOEDIT, "1");
  assert.equal(wanAndEditor[EDITOR_ENV], "1");
  assert.equal(Object.hasOwn(wanAndEditor, "SYNTX_OWNER_KLING4"), false);

  const combined = envOf(config({ includeKling4: true, includeWan27VideoEdit: true, includeSeedanceEditor: true }));
  assert.equal(combined.SYNTX_OWNER_KLING4, "1");
  assert.equal(combined.SYNTX_OWNER_WAN27_VIDEOEDIT, "1");
  assert.equal(combined[EDITOR_ENV], "1");

  for (const options of [
    {}, { includeSeedanceEditor: "true" }, { includeSeedanceEditor: true, surprise: false },
    Object.create(null), new Proxy({ includeSeedanceEditor: true }, {})
  ]) assert.throws(() => config(options));
  let getterCalls = 0;
  const accessor = Object.defineProperty({}, "includeSeedanceEditor", {
    enumerable: true,
    get() { getterCalls += 1; return true; }
  });
  assert.throws(() => config(accessor));
  assert.equal(getterCalls, 0);

  const denied = runCli([INCLUDE_SEEDANCE_EDITOR_FLAG]);
  assert.equal(denied.status, 2);
  assert.equal(denied.stdout, "");
  const accepted = runCli([PAID_TOOLS_CONFIRMATION_FLAG, INCLUDE_SEEDANCE_EDITOR_FLAG]);
  assert.equal(accepted.status, 0, accepted.stderr);
  const cliEnv = envOf(JSON.parse(accepted.stdout));
  assert.equal(cliEnv[EDITOR_ENV], "1");
  assert.equal(cliEnv[EDITOR_PROBE], "<absolute path to trusted ffprobe executable>");
  assert.equal(cliEnv[EDITOR_MAX], "67108864");
  const allGroups = runCli([PAID_TOOLS_CONFIRMATION_FLAG, INCLUDE_KLING4_FLAG, INCLUDE_WAN27_VIDEOEDIT_FLAG,
    INCLUDE_SEEDANCE_EDITOR_FLAG]);
  assert.equal(allGroups.status, 0, allGroups.stderr);
  const allGroupsEnv = envOf(JSON.parse(allGroups.stdout));
  assert.equal(allGroupsEnv.SYNTX_OWNER_KLING4, "1");
  assert.equal(allGroupsEnv.SYNTX_OWNER_WAN27_VIDEOEDIT, "1");
  assert.equal(allGroupsEnv[EDITOR_ENV], "1");

  let help = "";
  assert.equal(await main(["--help"], {
    writeStdout: text => { help += text; }
  }), 0);
  assert.match(help, /--include-seedance-editor/u);
  assert.match(help, /EXPERIMENTAL/u);
  assert.match(help, /live provider E2E.*unconfirmed/iu);
  assert.match(help, /one MP4\/MOV.*4–30 seconds/iu);
  assert.match(help, /64 MiB.*100 MiB/iu);
  assert.match(help, /trusted ffprobe executable/u);
  assert.match(help, /explicitly called/u);
  assert.match(help, /startup does not upload, probe, or generate/iu);
  assert.match(help, /no enforceable provider cost cap/iu);
});
