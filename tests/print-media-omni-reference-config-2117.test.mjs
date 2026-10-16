import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildMediaMcpConfig } from "../scripts/print-media-mcp-config.mjs";

const SCRIPT_PATH = fileURLToPath(new URL("../scripts/print-media-mcp-config.mjs", import.meta.url));

test("confirmed config enables reference mode independently with explicit trusted-local placeholders", () => {
  const server = buildMediaMcpConfig(pathToFileURL(SCRIPT_PATH).href, process.execPath).mcpServers.syntx;
  const env = server.env;
  assert.equal(env.SYNTX_OWNER_VEO_OMNI_REFERENCES, "1");
  assert.equal(env.SYNTX_OWNER_VEO_OMNI_REFERENCES_FFPROBE_PATH, "<absolute path to trusted ffprobe executable>");
  assert.equal(env.SYNTX_OWNER_VEO_OMNI_REFERENCES_MAX_FILE_BYTES, "67108864");
  assert.equal(env.SYNTX_OWNER_VEO_OMNI_T2V, "1");
  assert.equal(server.args.length, 1);
  assert.equal(server.args[0], join(SCRIPT_PATH, "..", "..", "dist", "src", "transports", "stdio-owner.js"));
});

test("unconfirmed config help emits no JSON and creates no cwd files", () => {
  const cwd = mkdtempSync(join(tmpdir(), "syntx-omni-reference-config-2117-"));
  try {
    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", SYNTX_OWNER_VEO_OMNI_REFERENCES: "1",
        SYNTX_OWNER_VEO_OMNI_REFERENCES_FFPROBE_PATH: "/not-used/ffprobe" }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Without the exact confirmation flag/u);
    assert.throws(() => JSON.parse(result.stdout));
    assert.deepEqual(readdirSync(cwd), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("installed checker pins six reference tools, a replaced probe fixture, and exact default-off isolation", async () => {
  const source = readFileSync(new URL("../scripts/check-package-install.mjs", import.meta.url), "utf8");
  const names = [
    "syntx_owner_get_veo_omni_reference_source",
    "syntx_owner_upload_veo_omni_reference",
    "syntx_owner_generate_veo_omni_references",
    "syntx_owner_reconcile_veo_omni_references",
    "syntx_owner_list_veo_omni_reference_recoveries",
    "syntx_owner_get_veo_omni_reference_result_page"
  ];
  for (const name of names) assert.ok(source.includes(name), `installed checker omits ${name}`);
  assert.match(source, /SYNTX_OWNER_VEO_OMNI_REFERENCES_FFPROBE_PATH:probeFixture/u);
  assert.match(source, /probeFixture=process\.platform==='win32'\?process\.execPath:join\(temp,'trusted-local-ffprobe-fixture\.mjs'\)/u,
    "installed smoke must replace the placeholder with a trusted local executable fixture");
  assert.match(source, /readFile\(probeMarker,'utf8'\)/u, "startup must not invoke the configured probe fixture");
  assert.match(source, /probeCalls=process\.platform==='win32'\?'NOT_INSTRUMENTED':'0'/u,
    "the Windows executable fallback must not be reported as instrumented");
  assert.match(source, /tool_calls=0 generation_posts=0/u, "installed smoke is startup/list-only");
  assert.match(source, /SYNTX_OWNER_VEO_OMNI_REFERENCES:'0'/u);
  assert.match(source, /jointToolCount-veoOmniReferencesOff\.count,\$\{veoOmniReferenceToolNames\.length\}/u);
  assert.match(source, /default_off_veo_omni_reference_tools=0/u);
  assert.match(source, /SYNTX_OWNER_VEO_OMNI_T2V:'0'/u);
});

test("installed checker builder assembles valid startup source and reports reference default-off as zero", async () => {
  const checker = readFileSync(new URL("../scripts/check-package-install.mjs", import.meta.url), "utf8");
  const start = checker.indexOf("async function assertInstalledMediaMcpConfig(");
  const end = checker.indexOf("\nasync function assertInstalledSyntxMaintenanceResources", start);
  assert.ok(start >= 0 && end > start, "installed checker function boundaries exist");
  const builderSource = checker.slice(start, end).trim();
  const packageRoot = join(tmpdir(), "syntx-config-builder-2117-fixture");
  const cliPath = join(packageRoot, "scripts", "print-media-mcp-config.mjs");
  const config = buildMediaMcpConfig(pathToFileURL(cliPath).href, process.execPath);
  const calls = [];
  let capturedChildProgram;
  const run = async (command, args, cwd) => {
    calls.push({ command, args, cwd });
    if (args.length === 1) return { stdout: "Without the exact confirmation flag\n", stderr: "" };
    if (args[1] === "--confirm-enable-paid-tools") return { stdout: JSON.stringify(config), stderr: "" };
    const evalIndex = args.indexOf("--eval");
    assert.ok(evalIndex >= 0, "third run is the captured inline installed-startup program");
    capturedChildProgram = args[evalIndex + 1];
    return { stdout: "media_config_cli=PASS enabled_flags=50 joint_tools=100 default_off_luma_tools=0 default_off_hailuo01_tools=0 default_off_hailuo01_director_tools=0 default_off_hailuo23_tools=0 default_off_video2audio_tools=0 default_off_kling_tools=0 default_off_veo_tools=0 default_off_veo_omni_t2v_tools=0 default_off_veo_omni_reference_tools=0 default_off_grok_t2v_tools=0 network=0 auth_calls=0 probe_calls=0 tool_calls=0 generation_posts=0 close=CLOSED pid_null=true stderr=0\n", stderr: "" };
  };
  class PackageSmokeError extends Error {}
  const installedCheckerFunction = runInNewContext(`(${builderSource})`, {
    process: { execPath: process.execPath, platform: process.platform }, join, run, realpath: async (path) => path, PackageSmokeError
  });
  await installedCheckerFunction(packageRoot, join(tmpdir(), "syntx-config-consumer-2117-fixture"));
  assert.equal(calls.length, 3);
  assert.equal(calls[2].args[0], "--input-type=module");
  assert.equal(typeof capturedChildProgram, "string");

  const temp = mkdtempSync(join(tmpdir(), "syntx-config-builder-child-2117-"));
  try {
    const childPath = join(temp, "installed-check.mjs");
    writeFileSync(childPath, capturedChildProgram, { mode: 0o600 });
    const syntax = spawnSync(process.execPath, ["--check", childPath], { encoding: "utf8" });
    assert.equal(syntax.status, 0, syntax.stderr);
  } finally { rmSync(temp, { recursive: true, force: true }); }

  const summaryLine = capturedChildProgram.split("\n").find((line) => line.includes("process.stdout.write('media_config_cli=PASS"));
  assert.ok(summaryLine, "captured startup builder writes its result summary");
  const summaryStart = summaryLine.indexOf("process.stdout.write(");
  const summaryCall = summaryLine.slice(summaryStart);
  const summaryOutput = [];
  runInNewContext(summaryCall, {
    process: { stdout: { write(value) { summaryOutput.push(value); } } },
    jointToolCount: 100, veoOmniOff: { count: 96 }, veoOmniReferencesOff: { count: 94 },
    hailuo23Off: { count: 90 }, video2AudioOff: { count: 95 }, hailuoLiveOff: { count: 96 }, probeCalls: "0"
  });
  assert.match(summaryOutput.join(""), /veo_omni_references_off_joint_tools=94/u);
  assert.match(summaryOutput.join(""), /default_off_veo_omni_reference_tools=0/u);
  assert.match(summaryOutput.join(""), /tool_calls=0 generation_posts=0/u);
});
