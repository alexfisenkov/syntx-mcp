import assert from "node:assert/strict";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import {
  buildMediaMcpConfig,
  main,
  parseArguments,
  MediaMcpConfigCliError
} from "../scripts/print-media-mcp-config.mjs";

const SCRIPT_PATH = fileURLToPath(new URL("../scripts/print-media-mcp-config.mjs", import.meta.url));
const ENABLE_FLAG = "--confirm-enable-paid-tools";
const ENABLED_FLAGS = [
  "SYNTX_OWNER_ACCOUNT_STATUS",
  "SYNTX_OWNER_CLARITY_UPSCALE",
  "SYNTX_OWNER_MAGNIFIC_UPSCALE",
  "SYNTX_OWNER_KONTEXT_IMAGE_REFERENCES",
  "SYNTX_OWNER_WAN_IMAGE_REFERENCES",
  "SYNTX_OWNER_STANDARD_IMAGE_REFERENCES",
  "SYNTX_OWNER_RUNWAY_IMAGE_REFERENCES",
  "SYNTX_OWNER_SEEDREAM_IMAGE_REFERENCES",
  "SYNTX_OWNER_SEEDREAM_EDITOR_IMAGE_REFERENCES",
  "SYNTX_OWNER_FLUX_IMAGE_REFERENCES",
  "SYNTX_OWNER_IDEOGRAM_IMAGE_REFERENCES",
  "SYNTX_OWNER_GROK_T2I_IMAGE_REFERENCES",
  "SYNTX_OWNER_UNI_IMAGE_REFERENCES",
  "SYNTX_OWNER_SOUL_IMAGE_REFERENCES",
  "SYNTX_OWNER_WAN_T2I_IMAGE",
  "SYNTX_OWNER_BANANA_INPAINT_IMAGE_REFERENCES",
  "SYNTX_OWNER_WAN_T2V_VIDEOS",
  "SYNTX_OWNER_ELEVENLABS_TTS",
  "SYNTX_OWNER_ELEVENLABS_DIALOGUE",
  "SYNTX_OWNER_SUNO_GENERATION",
  "SYNTX_OWNER_LUMA_T2V",
  "SYNTX_OWNER_HAILUO01_T2V",
  "SYNTX_OWNER_HAILUO01_DIRECTOR_T2V",
  "SYNTX_OWNER_HAILUO23_T2V",
  "SYNTX_OWNER_HAILUO02_T2V",
  "SYNTX_OWNER_VIDEO2AUDIO"
];
const DISABLED_FLAGS = [
  "SYNTX_OWNER_IMAGE_REFERENCES",
  "SYNTX_OWNER_GROK_IMAGE_REFERENCES",
  "SYNTX_OWNER_UPLOADED_FILES",
  "SYNTX_OWNER_UPLOAD_FILE",
  "SYNTX_OWNER_RECONCILE_UPLOADED_FILE",
  "SYNTX_OWNER_GENERATE_IMAGE",
  "SYNTX_OWNER_GENERATE_VIDEO",
  "SYNTX_OWNER_GENERATE_CONTRACT_MEDIA",
  "SYNTX_OWNER_DURABLE_GENERATION",
  "SYNTX_OWNER_SOUL_CATALOG_SHAPE",
  "SYNTX_OWNER_SOUL_STYLE_OPTIONS"
];

test("CLI defaults to help and emits no configuration without exact paid-tools confirmation", async () => {
  assert.deepEqual(parseArguments([]), { kind: "help" });
  assert.deepEqual(parseArguments(["--help"]), { kind: "help" });
  const stdout = [];
  const stderr = [];
  const result = await main([], {
    entryUrl: pathToFileURL(SCRIPT_PATH).href,
    writeStdout: (text) => stdout.push(text),
    writeStderr: (text) => stderr.push(text)
  });
  assert.equal(result, 0);
  assert.equal(stderr.join(""), "");
  assert.match(stdout.join(""), /--confirm-enable-paid-tools/u);
  assert.throws(() => JSON.parse(stdout.join("")));
});

test("CLI accepts only the exact confirmation flag and rejects all ambiguous arguments safely", async () => {
  assert.deepEqual(parseArguments([ENABLE_FLAG]), { kind: "emit" });
  for (const args of [
    ["--confirm-enable-paid-tool"],
    [ENABLE_FLAG, ENABLE_FLAG],
    [ENABLE_FLAG, "--help"],
    ["--enable-paid-tools"],
    ["--confirm-enable-paid-tools", "secret-value"]
  ]) {
    assert.throws(() => parseArguments(args), MediaMcpConfigCliError);
    const stdout = [];
    const stderr = [];
    const result = await main(args, {
      entryUrl: pathToFileURL(SCRIPT_PATH).href,
      writeStdout: (text) => stdout.push(text),
      writeStderr: (text) => stderr.push(text)
    });
    assert.equal(result, 2);
    assert.equal(stdout.join(""), "");
    assert.equal(stderr.join(""), "MEDIA_MCP_CONFIG_ARGUMENTS_INVALID\n");
    assert.equal(stderr.join("").includes("secret-value"), false);
  }
});

test("emitted JSON has absolute owner-stdio target and only the requested individual flags", () => {
  const config = buildMediaMcpConfig(pathToFileURL(SCRIPT_PATH).href, "/node/bin/node");
  const server = config.mcpServers.syntx;
  assert.deepEqual(Object.keys(config), ["mcpServers"]);
  assert.deepEqual(Object.keys(config.mcpServers), ["syntx"]);
  assert.equal(server.command, "/node/bin/node");
  assert.equal(server.args.length, 1);
  assert.equal(server.args[0], resolve(SCRIPT_PATH, "..", "..", "dist", "src", "transports", "stdio-owner.js"));
  assert.equal(server.args[0].endsWith(join("dist", "src", "transports", "stdio-owner.js")), true);
  assert.deepEqual(Object.fromEntries(ENABLED_FLAGS.map((flag) => [flag, server.env[flag]])),
    Object.fromEntries(ENABLED_FLAGS.map((flag) => [flag, "1"])));
  assert.deepEqual(Object.fromEntries(DISABLED_FLAGS.map((flag) => [flag, server.env[flag]])),
    Object.fromEntries(DISABLED_FLAGS.map((flag) => [flag, "0"])));
  assert.deepEqual(Object.keys(server.env).sort(), [...ENABLED_FLAGS, ...DISABLED_FLAGS].sort());
  assert.equal(JSON.stringify(config).includes("token"), false);
  assert.equal(JSON.stringify(config).includes(".env"), false);
});

test("Hailuo 2.3 opt-in is included only in the explicitly confirmed owner config", () => {
  const config = buildMediaMcpConfig(pathToFileURL(SCRIPT_PATH).href, "/node/bin/node");
  assert.equal(config.mcpServers.syntx.env.SYNTX_OWNER_HAILUO23_T2V, "1");
  assert.equal(ENABLED_FLAGS.includes("SYNTX_OWNER_HAILUO23_T2V"), true);
  assert.equal(DISABLED_FLAGS.includes("SYNTX_OWNER_HAILUO23_T2V"), false);
});

test("Video2Audio flag is emitted only after exact paid-tools confirmation", async () => {
  const helpOut = [], helpErr = [];
  await main([], { entryUrl: pathToFileURL(SCRIPT_PATH).href, writeStdout: (text) => helpOut.push(text), writeStderr: (text) => helpErr.push(text) });
  assert.equal(helpErr.join(""), "");
  assert.equal(helpOut.join("").includes("SYNTX_OWNER_VIDEO2AUDIO"), false);
  const configOut = [], configErr = [];
  await main([ENABLE_FLAG], { entryUrl: pathToFileURL(SCRIPT_PATH).href, writeStdout: (text) => configOut.push(text), writeStderr: (text) => configErr.push(text) });
  const emitted = JSON.parse(configOut.join(""));
  assert.equal(configErr.join(""), "");
  assert.equal(emitted.mcpServers.syntx.env.SYNTX_OWNER_VIDEO2AUDIO, "1");
  assert.equal(ENABLED_FLAGS.filter((flag) => flag === "SYNTX_OWNER_VIDEO2AUDIO").length, 1);
  assert.equal(DISABLED_FLAGS.includes("SYNTX_OWNER_VIDEO2AUDIO"), false);
  assert.equal(emitted.mcpServers.syntx.env.SYNTX_OWNER_DURABLE_GENERATION, "0");
});

test("CLI prints a valid config only after confirmation and does not depend on ambient paid flags", () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, ENABLE_FLAG], {
    cwd: tmpdir(),
    encoding: "utf8",
    env: {
      ...process.env,
      SYNTX_OWNER_GENERATE_IMAGE: "1",
      SYNTX_OWNER_GENERATE_VIDEO: "1",
      SYNTX_OWNER_HAILUO01_T2V: "0",
      SYNTX_OWNER_DURABLE_GENERATION: "1"
    }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const parsed = JSON.parse(result.stdout);
  for (const flag of ENABLED_FLAGS) assert.equal(parsed.mcpServers.syntx.env[flag], "1");
  for (const flag of DISABLED_FLAGS) assert.equal(parsed.mcpServers.syntx.env[flag], "0");
  assert.equal(parsed.mcpServers.syntx.env.SYNTX_OWNER_GENERATE_IMAGE, "0");
  assert.equal(parsed.mcpServers.syntx.env.SYNTX_OWNER_GENERATE_VIDEO, "0");
});

test("installed script resolves its package dist path even under Unicode/spaces and from another cwd", () => {
  const root = mkdtempSync(join(tmpdir(), "SYNTX медиа MCP — installed package "));
  try {
    const scripts = join(root, "scripts");
    const transport = join(root, "dist", "src", "transports");
    mkdirSync(scripts, { recursive: true });
    mkdirSync(transport, { recursive: true });
    copyFileSync(SCRIPT_PATH, join(scripts, "print-media-mcp-config.mjs"));
    const installedScript = join(scripts, "print-media-mcp-config.mjs");
    const result = spawnSync(process.execPath, [installedScript, ENABLE_FLAG], {
      cwd: tmpdir(),
      encoding: "utf8",
      env: {}
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const config = JSON.parse(result.stdout);
    assert.equal(config.mcpServers.syntx.args[0], join(realpathSync(transport), "stdio-owner.js"));
    assert.equal(config.mcpServers.syntx.args[0].includes("SYNTX медиа MCP — installed package"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("npm package exposes the CLI and ships its documentation and test", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const packageLock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  assert.equal(packageJson.bin["syntx-mcp-media-config"], "scripts/print-media-mcp-config.mjs");
  assert.equal(packageLock.packages[""].bin["syntx-mcp-media-config"], packageJson.bin["syntx-mcp-media-config"]);
  assert.equal(packageJson.files.includes("scripts/print-media-mcp-config.mjs"), true);
  assert.equal(packageJson.files.includes("docs"), true);
  assert.match(packageJson.scripts.test, /tests\/print-media-mcp-config\.test\.mjs/u);
});

test("every emitted flag is an existing owner-stdio flag", () => {
  const stdioSource = readFileSync(new URL("../src/transports/stdio-owner.ts", import.meta.url), "utf8");
  for (const flag of [...ENABLED_FLAGS, ...DISABLED_FLAGS]) {
    assert.equal(stdioSource.includes(flag), true, `unknown owner-stdio flag: ${flag}`);
  }
});

test("package smoke requires the installed config and combined media startup", () => {
  const source = readFileSync(new URL("../scripts/check-package-install.mjs", import.meta.url), "utf8");
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(source.includes(JSON.stringify(packageJson.scripts.test)), "installed manifest test-command pin is stale");
  assert.ok(/await assertInstalledMediaMcpConfig\(installedPackagePath, consumerPath\)/u.test(source), "mandatory installed config gate missing");
  assert.ok(/media_config_cli=PASS enabled_flags=24 joint_tools=/u.test(source), "installed config summary missing or stale");
  assert.ok(/config\.env\.SYNTX_OWNER_HAILUO01_T2V !== "1"/u.test(source), "installed config must explicitly emit the Hailuo opt-in flag");
  assert.ok(/config\.env\.SYNTX_OWNER_HAILUO01_DIRECTOR_T2V !== "1"/u.test(source), "installed config must explicitly emit the Hailuo Director opt-in flag");
  assert.ok(/config\.env\.SYNTX_OWNER_HAILUO23_T2V !== "1"/u.test(source), "installed config must explicitly emit the Hailuo 2.3 opt-in flag");
  assert.ok(/config\.env\.SYNTX_OWNER_VIDEO2AUDIO !== "1"/u.test(source), "installed config must explicitly emit the Video2Audio opt-in flag");
  assert.ok(/default_off_hailuo01_tools=0/u.test(source), "Hailuo default-off result is not summarized");
  assert.ok(/default_off_hailuo01_director_tools=0/u.test(source), "Hailuo Director default-off result is not summarized");
  assert.ok(/default_off_hailuo23_tools=0/u.test(source), "Hailuo 2.3 default-off result is not summarized");
  assert.ok(/default_off_video2audio_tools=0/u.test(source), "Video2Audio default-off result is not summarized");
  assert.ok(/\$\{installedMediaMcpConfig\}/u.test(source), "installed config summary is not emitted");
});

test("installed joint startup checks Luma tools and derives count from the returned tool list", () => {
  const source = readFileSync(new URL("../scripts/check-package-install.mjs", import.meta.url), "utf8");
  for (const name of [
    "syntx_owner_generate_luma_t2v",
    "syntx_owner_reconcile_luma_t2v",
    "syntx_owner_list_luma_t2v_recoveries"
  ]) assert.ok(source.includes(name), `installed joint list omits ${name}`);
  assert.ok(/const jointToolCount\s*=\s*optIn\.count/u.test(source), "joint count must come from the opt-in list result");
  assert.ok(/count:names\.length/u.test(source), "tool count must be derived from actual tools/list data");
  assert.ok(source.includes("SYNTX_OWNER_LUMA_T2V:'0'"), "paired startup must verify default-off behavior");
  assert.ok(/!defaultOff\.names\.includes\(n\)/u.test(source), "default-off tools must be absent");
  assert.doesNotMatch(source, /r\.tools\.length\s*,\s*103/u);
  assert.ok(source.includes("network_calls,0"), "installed startup must retain zero-network assertion");
  assert.ok(source.includes("tool_calls=0 generation_posts=0"), "startup-only check must not call tools or generate");
});

test("installed joint startup checks Hailuo tools and default-off pairing", () => {
  const source = readFileSync(new URL("../scripts/check-package-install.mjs", import.meta.url), "utf8");
  for (const name of [
    "syntx_owner_get_hailuo01_t2v_source",
    "syntx_owner_generate_hailuo01_t2v",
    "syntx_owner_reconcile_hailuo01_t2v",
    "syntx_owner_list_hailuo01_t2v_recoveries"
  ]) assert.ok(source.includes(name), `installed joint list omits ${name}`);
  assert.ok(/SYNTX_OWNER_HAILUO01_T2V:\s*'0'/u.test(source), "paired startup must verify default-off behavior");
  assert.ok(/count:names\.length/u.test(source), "tool count must be derived from actual tools/list data");
  assert.ok(/!defaultOff\.names\.includes\(n\)/u.test(source), "default-off tools must be absent");
  assert.ok(/jointToolCount\s*=\s*optIn\.count/u.test(source), "joint count must come from the opt-in list result");
});

test("installed joint startup checks Hailuo Director tools and default-off pairing", () => {
  const source = readFileSync(new URL("../scripts/check-package-install.mjs", import.meta.url), "utf8");
  for (const name of [
    "syntx_owner_get_hailuo01_director_t2v_source",
    "syntx_owner_generate_hailuo01_director_t2v",
    "syntx_owner_reconcile_hailuo01_director_t2v",
    "syntx_owner_list_hailuo01_director_t2v_recoveries"
  ]) assert.ok(source.includes(name), `installed joint list omits ${name}`);
  assert.ok(/SYNTX_OWNER_HAILUO01_DIRECTOR_T2V:\s*'0'/u.test(source), "paired startup must verify Director default-off behavior");
  assert.ok(/count:names\.length/u.test(source), "tool count must be derived from actual tools/list data");
  assert.ok(/!defaultOff\.names\.includes\(n\)/u.test(source), "default-off tools must be absent");
  assert.ok(/jointToolCount\s*=\s*optIn\.count/u.test(source), "joint count must come from the opt-in list result");
  assert.ok(source.includes("hailuoDirectorOff.names.includes(n)"), "Director-off startup must retain Luma and Hailuo-01 tools");
  assert.ok(source.includes("defaultOff.names.includes(n)"), "Luma-off startup must retain Director tools");
  assert.ok(source.includes("hailuoOff.names.includes(n)"), "Hailuo-01-off startup must retain Director tools");
});

test("package smoke requires a separate installed synthetic Luma SDK call proof", () => {
  const source = readFileSync(new URL("../scripts/check-package-install.mjs", import.meta.url), "utf8");
  const checker = readFileSync(new URL("../scripts/check-installed-luma-t2v-flow.mjs", import.meta.url), "utf8");
  assert.ok(/assertInstalledLumaT2vFlow\(/u.test(source), "installed Luma synthetic checker is not invoked");
  assert.ok(/formatLumaT2vInstalledSummary\(/u.test(source), "installed Luma synthetic result is not summarized");
  assert.ok(source.includes("${installedLumaT2vFlow}"), "Luma synthetic SDK result is not included in package summary");
  assert.ok(checker.includes("luma_t2v_installed="), "Luma synthetic SDK summary prefix is missing");
});

test("package smoke requires separate installed synthetic Hailuo SDK call proof", () => {
  const source = readFileSync(new URL("../scripts/check-package-install.mjs", import.meta.url), "utf8");
  const checker = readFileSync(new URL("../scripts/check-installed-hailuo01-t2v-flow.mjs", import.meta.url), "utf8");
  assert.ok(/assertInstalledHailuo01T2vFlow\(/u.test(source), "installed Hailuo synthetic checker is not invoked");
  assert.ok(/formatHailuo01T2vInstalledSummary\(/u.test(source), "installed Hailuo synthetic result is not summarized");
  assert.ok(source.includes("${installedHailuo01T2vFlow}"), "Hailuo synthetic SDK result is not included in package summary");
  assert.ok(checker.includes("hailuo01_t2v_installed="), "Hailuo synthetic SDK summary prefix is missing");
});

test("package smoke requires a separate installed synthetic Hailuo Director SDK call proof", () => {
  const source = readFileSync(new URL("../scripts/check-package-install.mjs", import.meta.url), "utf8");
  const checkerPath = new URL("../scripts/check-installed-hailuo01-director-t2v-flow.mjs", import.meta.url);
  assert.equal(existsSync(checkerPath), true, "installed Director synthetic checker is missing");
  const checker = readFileSync(checkerPath, "utf8");
  assert.ok(/assertInstalledHailuo01DirectorT2vFlow\(/u.test(source), "installed Hailuo Director synthetic checker is not invoked");
  assert.ok(/formatHailuo01DirectorT2vInstalledSummary\(/u.test(source), "installed Hailuo Director result is not summarized");
  assert.ok(source.includes("${installedHailuo01DirectorT2vFlow}"), "Director SDK result is not included in package summary");
  assert.ok(checker.includes("hailuo01_director_t2v_installed="), "Director synthetic SDK summary prefix is missing");
});

test("package smoke requires an installed synthetic Hailuo 2.3 SDK flow proof", () => {
  const checkerPath = new URL("../scripts/check-installed-hailuo23-t2v-flow.mjs", import.meta.url);
  assert.equal(existsSync(checkerPath), true, "installed Hailuo 2.3 synthetic checker is missing");
  const checker = readFileSync(checkerPath, "utf8");
  const source = readFileSync(new URL("../scripts/check-package-install.mjs", import.meta.url), "utf8");
  assert.ok(/assertInstalledHailuo23T2vFlow\(/u.test(source), "installed Hailuo 2.3 checker is not invoked");
  assert.ok(/formatHailuo23T2vInstalledSummary\(/u.test(source), "installed Hailuo 2.3 result is not summarized");
  assert.ok(source.includes("${installedHailuo23T2vFlow}"), "Hailuo 2.3 SDK result is absent from package summary");
  assert.ok(checker.includes("hailuo23_t2v_installed="), "Hailuo 2.3 synthetic SDK summary prefix is missing");
});

test("package smoke requires a separate installed Video2Audio synthetic SDK flow proof", () => {
  const checkerPath = new URL("../scripts/check-installed-video2audio-flow.mjs", import.meta.url);
  assert.equal(existsSync(checkerPath), true, "installed Video2Audio synthetic checker is missing");
  const checker = readFileSync(checkerPath, "utf8");
  const source = readFileSync(new URL("../scripts/check-package-install.mjs", import.meta.url), "utf8");
  assert.ok(/assertInstalledVideo2AudioFlow\(/u.test(source), "installed Video2Audio checker is not invoked");
  assert.ok(/formatVideo2AudioInstalledSummary\(/u.test(source), "installed Video2Audio result is not summarized");
  assert.ok(source.includes("${installedVideo2AudioFlow}"), "Video2Audio synthetic SDK result is absent from package summary");
  assert.ok(checker.includes("video2audio_installed="), "Video2Audio synthetic checker summary prefix is missing");
});

test("Node24-pinned installed SDK fixtures verify all synthetic flows; other versions assert the explicit guard", async () => {
  if (process.versions.node !== "24.21.0") {
    const [luma, hailuo, director, hailuo23] = await Promise.all([
      import("../scripts/check-installed-luma-t2v-flow.mjs"),
      import("../scripts/check-installed-hailuo01-t2v-flow.mjs"),
      import("../scripts/check-installed-hailuo01-director-t2v-flow.mjs"),
      import("../scripts/check-installed-hailuo23-t2v-flow.mjs")
    ]);
    const probePath = resolve(tmpdir(), "node24-pinned-checker-version-probe");
    const checks = [
      [luma.assertInstalledLumaT2vFlow, "INSTALLED_LUMA_T2V_NODE24_21_REQUIRED"],
      [hailuo.assertInstalledHailuo01T2vFlow, "INSTALLED_HAILUO01_T2V_NODE24_21_REQUIRED"],
      [director.assertInstalledHailuo01DirectorT2vFlow, "INSTALLED_HAILUO01_DIRECTOR_T2V_NODE24_21_REQUIRED"],
      [hailuo23.assertInstalledHailuo23T2vFlow, "INSTALLED_HAILUO23_T2V_NODE24_21_REQUIRED"]
    ];
    for (const [check, code] of checks) {
      await assert.rejects(() => check(probePath, probePath, new Set()), (error) => error?.code === code);
    }
    return;
  }

  const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const temporaryRoot = mkdtempSync(join(tmpdir(), "luma-t2v-isolated-checker-"));
  const isolatedPackage = join(temporaryRoot, "package");
  const consumer = join(temporaryRoot, "consumer");
  mkdirSync(isolatedPackage, { recursive: true });
  mkdirSync(consumer, { recursive: true });
  try {
    const compile = spawnSync(process.execPath, [
      join(projectRoot, "node_modules/typescript/bin/tsc"), "-p", join(projectRoot, "tsconfig.json"),
      "--outDir", join(isolatedPackage, "dist")
    ], { cwd: projectRoot, encoding: "utf8", timeout: 120_000 });
    assert.equal(compile.status, 0, (compile.stderr || compile.stdout).slice(-4_000));
    copyFileSync(join(projectRoot, "package.json"), join(isolatedPackage, "package.json"));
    cpSync(join(projectRoot, "catalog"), join(isolatedPackage, "catalog"), { recursive: true });
    symlinkSync(join(projectRoot, "node_modules"), join(isolatedPackage, "node_modules"), "dir");
    writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
    symlinkSync(join(projectRoot, "node_modules"), join(consumer, "node_modules"), "dir");

    const parameterTests = spawnSync(process.execPath, ["--test", join(isolatedPackage,
      "dist/tests/owner-luma-t2v-generation-parameters.test.js")], { cwd: isolatedPackage, encoding: "utf8", timeout: 30_000 });
    assert.equal(parameterTests.status, 0, (parameterTests.stderr || parameterTests.stdout).slice(-3_000));

    const service = await import(pathToFileURL(join(isolatedPackage, "dist/src/application/owner-luma-t2v-contract-service.js")).href);
    const registry = service.OWNER_LUMA_T2V_CONTRACT_REGISTRY_VERSION;
    const packagedPaths = new Set([
      "package.json", "dist/src/index.js", "dist/src/transports/stdio-owner.js",
      "dist/src/application/owner-luma-t2v-generation-parameters.js",
      "dist/src/application/owner-luma-t2v-contract-service.js", "dist/src/mcp/owner-luma-t2v-tool.js",
      "dist/src/mcp/server.js", "dist/src/runtime/observed-owner-runtime.js",
      "catalog/public/sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json",
      "catalog/settings/v2/sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json",
      `catalog/generation-contracts-v2/${registry}`
    ]);
    const checker = await import(new URL("../scripts/check-installed-luma-t2v-flow.mjs", import.meta.url));
    const proof = await checker.assertInstalledLumaT2vFlow(isolatedPackage, consumer, packagedPaths,
      { package_provenance: "isolated-compiled-copy" });
    assert.equal(proof.status, "ISOLATED_LUMA_T2V_SYNTHETIC_CALLTOOL_PASS");
    assert.equal(proof.clean_installed_package, false);
    assert.equal(proof.synthetic_generation_posts, 1);
    assert.equal(proof.external_network_calls, 0);
    assert.equal(proof.cleanup.luma_lifecycle_closed, true);
    assert.equal(proof.cleanup.client_closed, true);
    assert.equal(proof.cleanup.server_closed, true);
    assert.equal(proof.cleanup.auth_store_closed, true);
    assert.equal(proof.auth_store_close_returned_void, true);

    const hailuoProfile = await import(pathToFileURL(join(isolatedPackage, "dist/src/application/owner-hailuo01-t2v-profile.js")).href);
    const hailuoRegistry = hailuoProfile.OWNER_HAILUO01_T2V_CONTRACT_REGISTRY_VERSION;
    const hailuoPackagedPaths = new Set([
      "package.json", "dist/src/index.js", "dist/src/transports/stdio-owner.js",
      "dist/src/application/owner-hailuo01-t2v-profile.js",
      "dist/src/application/owner-reviewed-no-reference-t2v-service.js",
      "dist/src/mcp/owner-hailuo01-t2v-tool.js", "dist/src/mcp/server.js",
      "dist/src/runtime/observed-owner-runtime.js",
      "catalog/public/sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json",
      "catalog/settings/v2/sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json",
      `catalog/generation-contracts-v2/${hailuoRegistry}`
    ]);
    const hailuoChecker = await import(new URL("../scripts/check-installed-hailuo01-t2v-flow.mjs", import.meta.url));
    const hailuoProof = await hailuoChecker.assertInstalledHailuo01T2vFlow(isolatedPackage, consumer, hailuoPackagedPaths,
      { package_provenance: "isolated-compiled-copy" });
    assert.equal(hailuoProof.status, "ISOLATED_HAILUO01_T2V_SYNTHETIC_CALLTOOL_PASS");
    assert.equal(hailuoProof.clean_installed_package, false);
    assert.equal(hailuoProof.synthetic_generation_posts, 3);
    assert.equal(hailuoProof.external_network_calls, 0);
    assert.equal(hailuoProof.synthetic_model_access_reads, 6);
    assert.equal(hailuoProof.cleanup.unlinks_confirmed, true);
    assert.equal(hailuoProof.cleanup.hailuo_lifecycle_closed, true);
    assert.equal(hailuoProof.cleanup.client_closed, true);
    assert.equal(hailuoProof.cleanup.server_closed, true);
    assert.equal(hailuoProof.cleanup.auth_store_closed, true);
    assert.equal(hailuoProof.auth_store_close_returned_void, true);

    const directorProfile = await import(pathToFileURL(join(isolatedPackage, "dist/src/application/owner-hailuo01-director-t2v-profile.js")).href);
    const directorRegistry = directorProfile.OWNER_HAILUO01_DIRECTOR_T2V_CONTRACT_REGISTRY_VERSION;
    assert.equal(directorRegistry, "sha256-081330c3e79fe53470a1e91242fd6913333a71cf66260120863dffc0cec72b4f.json");
    const directorSource = directorProfile.createOwnerHailuo01DirectorT2vProfile(join(isolatedPackage, "catalog")).source;
    assert.equal(directorSource.identity.model_id, "hailuo-01-director");
    assert.equal(directorSource.ui_observation.result, "PENDING");
    assert.equal(directorSource.backend_acceptance, "UNPROVEN");
    const directorCheckerPath = new URL("../scripts/check-installed-hailuo01-director-t2v-flow.mjs", import.meta.url);
    assert.equal(existsSync(directorCheckerPath), true, "installed Director synthetic checker is missing");
    const directorPackagedPaths = new Set([
      "package.json", "dist/src/index.js", "dist/src/transports/stdio-owner.js",
      "dist/src/application/owner-hailuo01-director-t2v-profile.js",
      "dist/src/application/owner-reviewed-no-reference-t2v-service.js",
      "dist/src/mcp/owner-hailuo01-director-t2v-tool.js", "dist/src/mcp/server.js",
      "dist/src/runtime/observed-owner-runtime.js",
      "catalog/public/sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json",
      "catalog/settings/v2/sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json",
      `catalog/generation-contracts-v2/${directorRegistry}`
    ]);
    const directorChecker = await import(directorCheckerPath);
    const directorProof = await directorChecker.assertInstalledHailuo01DirectorT2vFlow(
      isolatedPackage, consumer, directorPackagedPaths, { package_provenance: "isolated-compiled-copy" });
    assert.equal(directorProof.status, "ISOLATED_HAILUO01_DIRECTOR_T2V_SYNTHETIC_CALLTOOL_PASS");
    assert.equal(directorProof.model, "hailuo-01-director");
    assert.equal(directorProof.clean_installed_package, false);
    assert.equal(directorProof.synthetic_generation_posts, 3);
    assert.equal(directorProof.synthetic_model_access_reads, 6);
    assert.equal(directorProof.source_ui_result, "PENDING");
    assert.equal(directorProof.source_backend_acceptance, "UNPROVEN");
    assert.equal(directorProof.cleanup.unlinks_confirmed, true);
    assert.equal(directorProof.cleanup.director_lifecycle_closed, true);
    assert.equal(directorProof.cleanup.client_closed, true);
    assert.equal(directorProof.cleanup.server_closed, true);
    assert.equal(directorProof.cleanup.auth_store_closed, true);
    assert.equal(directorProof.auth_store_close_returned_void, true);

    const hailuo23Profile = await import(pathToFileURL(join(isolatedPackage, "dist/src/application/owner-hailuo23-t2v-profile.js")).href);
    const hailuo23Registry = hailuo23Profile.OWNER_HAILUO23_T2V_CONTRACT_REGISTRY_VERSION;
    assert.equal(hailuo23Registry, "sha256-0ca3bf6c8448edf63ba220fe1cedf548a7a909f0408978746d56861e648e2b83.json");
    const hailuo23Source = hailuo23Profile.createOwnerHailuo23T2vProfile(join(isolatedPackage, "catalog")).source;
    assert.equal(hailuo23Source.identity.model_id, "hailuo-2.3");
    assert.deepEqual(hailuo23Source.controls.valid_pairs, [
      { resolution: "768p", video_duration: 6 }, { resolution: "768p", video_duration: 10 }, { resolution: "1080p", video_duration: 6 }
    ]);
    assert.deepEqual(hailuo23Source.ui_observation.provider_verified_pair, { resolution: "768p", video_duration: 6 });
    assert.equal(hailuo23Source.runtime_usable, false);
    assert.equal(hailuo23Source.backend_acceptance, "UNPROVEN");
    const hailuo23CheckerPath = new URL("../scripts/check-installed-hailuo23-t2v-flow.mjs", import.meta.url);
    const hailuo23PackagedPaths = new Set([
      "package.json", "dist/src/index.js", "dist/src/transports/stdio-owner.js",
      "dist/src/application/owner-hailuo23-t2v-profile.js", "dist/src/application/owner-reviewed-no-reference-t2v-service.js",
      "dist/src/mcp/owner-hailuo23-t2v-tool.js", "dist/src/mcp/server.js", "dist/src/runtime/observed-owner-runtime.js",
      `catalog/public/sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json`,
      `catalog/settings/v2/sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json`,
      `catalog/generation-contracts-v2/${hailuo23Registry}`
    ]);
    const hailuo23Checker = await import(hailuo23CheckerPath);
    const hailuo23Proof = await hailuo23Checker.assertInstalledHailuo23T2vFlow(
      isolatedPackage, consumer, hailuo23PackagedPaths, { package_provenance: "isolated-compiled-copy" });
    assert.equal(hailuo23Proof.status, "ISOLATED_HAILUO23_T2V_SYNTHETIC_CALLTOOL_PASS");
    assert.equal(hailuo23Proof.model, "hailuo-2.3");
    assert.equal(hailuo23Proof.synthetic_generation_posts, 3);
    assert.equal(hailuo23Proof.synthetic_model_access_reads, 6);
    assert.deepEqual(hailuo23Proof.source_ui_verified_pair, { resolution: "768p", video_duration: 6 });
    assert.equal(hailuo23Proof.source_backend_acceptance, "UNPROVEN");
    assert.equal(hailuo23Proof.cleanup.unlinks_confirmed, true);
    assert.equal(hailuo23Proof.cleanup.hailuo23_lifecycle_closed, true);
    assert.equal(hailuo23Proof.cleanup.client_closed, true);
    assert.equal(hailuo23Proof.cleanup.server_closed, true);
    assert.equal(hailuo23Proof.cleanup.auth_store_closed, true);
    assert.equal(hailuo23Proof.auth_store_close_returned_void, true);

    const video2audioProfile = await import(pathToFileURL(join(isolatedPackage,
      "dist/src/application/owner-video2audio-source-profile.js")).href);
    const video2audioSource = video2audioProfile.createOwnerVideo2AudioSourceProfile(join(isolatedPackage, "catalog")).source;
    assert.equal(video2audioSource.identity.model_id, "video2audio");
    assert.equal(video2audioSource.runtime_usable, false);
    assert.equal(video2audioSource.dispatch_allowed, false);
    assert.equal(video2audioSource.backend_acceptance, "UNPROVEN");
    const video2audioCheckerPath = new URL("../scripts/check-installed-video2audio-flow.mjs", import.meta.url);
    assert.equal(existsSync(video2audioCheckerPath), true, "installed Video2Audio synthetic checker is missing");
    const video2audioPackagedPaths = new Set([
      "package.json", "dist/src/index.js", "dist/src/transports/stdio-owner.js", "dist/src/mcp/server.js",
      "dist/src/runtime/observed-owner-runtime.js", "dist/src/adapter/syntx/chat-http-client.js",
      "dist/src/adapter/syntx/video2audio-original-codec.js", "dist/src/application/owner-video2audio-source-profile.js",
      "dist/src/application/owner-video2audio-input-parameters.js", "dist/src/application/owner-video2audio-original-reference-service.js",
      "dist/src/application/owner-video2audio-request-preparer.js", "dist/src/application/owner-video2audio-one-shot-policy.js",
      "dist/src/application/owner-video2audio-generation-service.js", "dist/src/application/owner-video2audio-result-codec.js",
      "dist/src/mcp/owner-video2audio-tools.js",
      "catalog/public/sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json",
      "catalog/settings/v2/sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json"
    ]);
    const video2audioChecker = await import(video2audioCheckerPath);
    const video2audioProof = await video2audioChecker.assertInstalledVideo2AudioFlow(
      isolatedPackage, consumer, video2audioPackagedPaths, { package_provenance: "isolated-compiled-copy" });
    assert.equal(video2audioProof.status, "ISOLATED_VIDEO2AUDIO_SYNTHETIC_CALLTOOL_PASS");
    assert.equal(video2audioProof.model, "video2audio");
    assert.deepEqual(video2audioProof.tool_names, [
      "syntx_owner_get_video2audio_source", "syntx_upload_video2audio_original", "syntx_owner_generate_video2audio",
      "syntx_owner_reconcile_video2audio", "syntx_owner_list_video2audio_recoveries", "syntx_owner_get_video2audio_result_page"
    ]);
    assert.equal(video2audioProof.clean_installed_package, false);
    assert.equal(video2audioProof.synthetic_generation_posts, 5);
    assert.equal(video2audioProof.synthetic_unknown_post_count, 1);
    assert.equal(video2audioProof.synthetic_model_access_reads, 10);
    assert.equal(video2audioProof.synthetic_account_reads, 20);
    assert.equal(video2audioProof.synthetic_upload_posts, 5);
    assert.equal(video2audioProof.synthetic_history_gets >= 2, true);
    assert.equal(video2audioProof.synthetic_result_gets >= 3, true);
    assert.equal(video2audioProof.local_page_size, 64);
    assert.equal(video2audioProof.default_off_tool_count, 0);
    assert.equal(video2audioProof.known_ack_after_ttl_uses_captured_client, true);
    assert.equal(video2audioProof.lost_ack_is_listable_without_replay, true);
    assert.equal(video2audioProof.same_intent_replay_posts, 0);
    assert.equal(video2audioProof.revocation_blocks_result_get, true);
    assert.equal(video2audioProof.host_cancel_recovery_listable_without_replay, true);
    assert.equal(JSON.stringify(video2audioProof).includes("synthetic-video2audio"), false);
    assert.equal(video2audioProof.startup_network_calls, 0);
    assert.equal(video2audioProof.external_network_calls, 0);
    assert.equal(video2audioProof.billing_calls, 0);
    assert.equal(video2audioProof.source_runtime_usable, false);
    assert.equal(video2audioProof.source_dispatch_allowed, false);
    assert.equal(video2audioProof.source_backend_acceptance, "UNPROVEN");
    assert.equal(video2audioProof.cleanup.unlinks_confirmed, true);
    assert.equal(video2audioProof.cleanup.video2audio_lifecycle_closed, true);
    assert.equal(video2audioProof.cleanup.client_closed, true);
    assert.equal(video2audioProof.cleanup.server_closed, true);
    assert.equal(video2audioProof.cleanup.auth_store_closed, true);
    assert.equal(video2audioProof.cleanup.default_off_client_closed, true);
    assert.equal(video2audioProof.cleanup.default_off_server_closed, true);
    assert.equal(video2audioProof.cleanup.default_off_auth_store_closed, true);
    assert.equal(video2audioProof.auth_store_close_returned_void, true);
    assert.match(video2audioChecker.formatVideo2AudioInstalledSummary(video2audioProof),
      /^video2audio_installed=ISOLATED_VIDEO2AUDIO_SYNTHETIC_CALLTOOL_PASS/u);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("compiled MCP startup, initialize, and tools/list remain network-free on supported Node versions", async () => {
  const [runtimeModule, serverModule, sdkClientModule, sdkTransportModule, sdkStdioModule] = await Promise.all([
    import("../dist/src/runtime/observed-owner-runtime.js"),
    import("../dist/src/mcp/server.js"),
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/inMemory.js"),
    import("@modelcontextprotocol/sdk/client/stdio.js")
  ]);
  let networkCalls = 0;
  const runtime = runtimeModule.createObservedOwnerRuntime({
    fetchImpl: async () => {
      networkCalls += 1;
      throw new Error("MCP initialization and tools/list must be local-only.");
    }
  });
  const server = serverModule.createMcpServer(runtime.application, runtime.serverOptions);
  const client = new sdkClientModule.Client({ name: "cross-version-startup-smoke", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = sdkTransportModule.InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    assert.equal(client.getServerVersion()?.name, "syntx-mcp");
    assert.equal(typeof client.getServerVersion()?.version, "string");
    const names = (await client.listTools()).tools.map(({ name }) => name);
    assert.equal(names.includes("syntx_search_models"), true);
    assert.equal(names.includes("syntx_owner_generate_luma_t2v"), false);
    assert.equal(networkCalls, 0);
  } finally {
    await client.close();
    await server.close();
    if (typeof runtime.authStore?.close === "function") await Promise.resolve(runtime.authStore.close());
  }

  const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const stdioOwnerPath = join(projectRoot, "dist", "src", "transports", "stdio-owner.js");
  const permittedChildEnvironment = new Set([
    "path", "systemroot", "windir", "temp", "tmp", "userprofile", "appdata", "localappdata", "comspec", "pathext"
  ]);
  const childEnvironment = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => permittedChildEnvironment.has(name.toLowerCase())));
  const stdioTransport = new sdkStdioModule.StdioClientTransport({
    command: process.execPath,
    args: [stdioOwnerPath],
    cwd: projectRoot,
    env: childEnvironment,
    stderr: "pipe"
  });
  const stdioClient = new sdkClientModule.Client({ name: "cross-version-stdio-startup-smoke", version: "1.0.0" }, { capabilities: {} });
  try {
    await stdioClient.connect(stdioTransport);
    assert.equal(stdioClient.getServerVersion()?.name, "syntx-mcp");
    const stdioNames = (await stdioClient.listTools()).tools.map(({ name }) => name);
    assert.equal(stdioNames.includes("syntx_search_models"), true);
    assert.equal(stdioNames.includes("syntx_owner_generate_luma_t2v"), false);
  } finally {
    await stdioClient.close();
  }
});
